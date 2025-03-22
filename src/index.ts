import * as fs from 'fs-extra';
import * as path from 'node:path';
import * as crypto from 'crypto';
import simpleGit, { DefaultLogFields, ListLogLine, SimpleGit, SimpleGitOptions } from 'simple-git';
import { arg, createProgram, createCommand, flag } from "commandstruct";

const pushCmd = createCommand("push")
    .describe("push changes")
    .args({
        from: arg(),
        target: arg(),
    })
    .action(async ({ args }) => {
        console.log("pushing repo", args.from, "to", args.target);
        try {
            const { git, paths } = await init(args.from, args.target)
            await cloneDevRepo(git, paths.DEV_REPO_PATH, paths.TEMP_CLONE_PATH);
            // copyFilesToLive(paths.TEMP_CLONE_PATH, paths.LIVE_REPO_PATH);
            await syncGitHistory(paths.TEMP_CLONE_PATH, paths.LIVE_REPO_PATH);
            fs.removeSync(paths.TEMP_CLONE_PATH);
        } catch (error) {
            console.error('RepoSync Error:', error);
        }
    });

const prog = createProgram("reposync")
    .describe("sync two repositries")
    .flags({ verbose: flag("display extra information on command run") })
    .commands(pushCmd)
    .build();

prog.run();


async function init(devRepoPath: string, liveRepoPath: string) {
    let DEV_REPO_PATH = devRepoPath.startsWith('http://') || devRepoPath.startsWith('https://') ? devRepoPath : path.resolve(devRepoPath);
    let LIVE_REPO_PATH = liveRepoPath.startsWith('http://') || liveRepoPath.startsWith('https://') ? liveRepoPath : path.resolve(liveRepoPath);
    let TEMP_CLONE_PATH = path.resolve('reposync_' + Date.now() + '_temp');

    // Initialize simple-git with options
    if (fs.existsSync(TEMP_CLONE_PATH)) {

        console.warn(`Temporary clone path already exists: ${TEMP_CLONE_PATH}. Renaming it instead of removing.`);
        TEMP_CLONE_PATH = TEMP_CLONE_PATH + '_backup_' + Date.now();
    }
    fs.mkdirSync(TEMP_CLONE_PATH);
    const options: Partial<SimpleGitOptions> = {
        baseDir: TEMP_CLONE_PATH,
        binary: 'git',
        maxConcurrentProcesses: 6,
    };
    const git: SimpleGit = simpleGit(options);
    return {
        git, options, paths: {
            DEV_REPO_PATH,
            TEMP_CLONE_PATH,
            LIVE_REPO_PATH,
        }
    }
}
async function cloneDevRepo(git: SimpleGit, fromPath: string, tempPath: string) {
    console.log(`RepoSync: Cloning ${fromPath} into ${tempPath}`);
    await git.clone(fromPath, tempPath, {

    }, (err, data) => console.log("finished cloning", err, data));
}

function hashFile(filePath: string): string {
    const fileBuffer = fs.readFileSync(filePath);
    const hashSum = crypto.createHash('sha256');
    hashSum.update(fileBuffer);
    return hashSum.digest('hex');
}

function filesAreDifferent(src: string, dest: string): boolean {
    const srcStat = fs.statSync(src);
    const destStat = fs.statSync(dest);

    // Compare file size and modification time first
    if (srcStat.size !== destStat.size || srcStat.mtimeMs !== destStat.mtimeMs) {
        return true;
    }

    // If size and modification time are the same, compare file hashes
    const srcHash = hashFile(src);
    const destHash = hashFile(dest);
    return srcHash !== destHash;
}

async function getLastCommitMessage(repoPath: string): Promise<string> {
    const repoGit = simpleGit(repoPath);
    const log = await repoGit.log();
    return log.latest?.message || 'updates made...';
}


function shouldCopyFile(basePath: string, filePath: string): boolean {
    const relativePath = path.relative(basePath, filePath);
    return !relativePath.startsWith('.git') && relativePath !== '.gitignore' && !relativePath.includes("node_modules") && !relativePath.includes(".next");
}


function synchronizeFiles(tempPath: string, livePath: string) {
    const tempItems = fs.readdirSync(tempPath);
    const liveItems = fs.readdirSync(livePath);

    // Copy and update files from temp to live
    tempItems.forEach((item) => {
        const tempItemPath = path.join(tempPath, item);
        const liveItemPath = path.join(livePath, item);

        if (!shouldCopyFile(tempPath, tempItemPath)) return

        if (fs.statSync(tempItemPath).isDirectory()) {
            if (shouldCopyFile(tempPath, tempItemPath)) {
                if (!fs.existsSync(liveItemPath)) {
                    console.log(`Copying new Dir: ${tempItemPath}`);
                    fs.copySync(tempItemPath, liveItemPath);
                } else {
                    synchronizeFiles(tempItemPath, liveItemPath);
                }
            }
        } else {
            if (shouldCopyFile(tempPath, tempItemPath)) {
                if (!fs.existsSync(liveItemPath)) {
                    console.log(`Copying new file from: ${tempItemPath}`);
                    fs.copyFileSync(tempItemPath, liveItemPath);
                } else if (filesAreDifferent(tempItemPath, liveItemPath)) {
                    console.log(`Replacing file: ${tempItemPath}`);

                    fs.copyFileSync(tempItemPath, liveItemPath);
                }
            }
        }
    });

    // Delete files from live that are not present in temp
    liveItems.forEach((item) => {
        const tempItemPath = path.join(tempPath, item);
        const liveItemPath = path.join(livePath, item);

        if (!fs.existsSync(tempItemPath) && shouldCopyFile(livePath, liveItemPath)) {
            console.log(`Deleting file: ${liveItemPath}`);
            fs.removeSync(liveItemPath);
        }
    });
}

function copyFilesToLive(tempPath: string, livePath: string) {
    console.log(`RepoSync: Synchronizing files from ${tempPath} to ${livePath}`);
    if (!fs.existsSync(livePath)) {
        fs.mkdirSync(livePath);
    }
    synchronizeFiles(tempPath, livePath);
}

async function syncGitHistory(tempPath: string, livePath: string) {
    if (!fs.existsSync(livePath)) {
        fs.mkdirSync(livePath);
    }
    const liveGit = simpleGit(livePath);
    const tempGit = simpleGit(tempPath);

    if (!(await liveGit.checkIsRepo())) {
        await liveGit.init();
    }

    // Get all commits from temp repository in reverse chronological order
    const commits = await tempGit.log();
    const orderedCommits = [...commits.all].reverse(); // Process from newest to oldest

    // Get existing commit details from live repo to avoid duplicates
    let existingCommits: readonly (DefaultLogFields & ListLogLine)[] = [];
    try {
        const liveCommits = await liveGit.log();
        existingCommits = [...liveCommits.all];
    } catch (error) {
        console.log('RepoSync: Target repository is empty, proceeding with initial sync');
    }

    for (const commit of orderedCommits) {

        // Check if this is a merge commit
        const isMergeCommit = commit.message.toLowerCase().includes("merge");

        // Modify commit message for merge commits
        let commitMessage = commit.message;
        if (isMergeCommit) {
            commitMessage = `${commit.hash.slice(-5)}`;
            console.log(`RepoSync: Processing merge commit: ${commitMessage}`);
        }

        // Check if this commit already exists by comparing multiple attributes
        const matchingCommit = existingCommits.find(existingCommit => {
            // Compare commit message (excluding merge commit special cases)
            const messageMatches = commitMessage === existingCommit.message;
            
            // Compare commit date (allowing small time differences)
            const dateMatches = Math.abs(new Date(commit.date).getTime() - 
                                       new Date(existingCommit.date).getTime()) < 1000;
            
            return messageMatches && dateMatches;
        });

        if (matchingCommit) {
            console.log(`RepoSync: Skipping existing commit with message: ${commit.message}`);
            continue;
        }


        // Checkout this commit in the temp repository
        await tempGit.checkout(commit.hash);

        // Copy files at this commit state to live repository
        copyFilesToLive(tempPath, livePath);

        // Stage and commit changes with original commit info and date
        await liveGit.add('.');
        // Set both author and committer dates to match the original commit
        process.env.GIT_COMMITTER_DATE = commit.date;
        await liveGit.commit(commitMessage, {
            '--date': commit.date
        });
        delete process.env.GIT_COMMITTER_DATE;

        console.log(`RepoSync: Applied commit: ${commitMessage}`);
    }

    // Return to the latest commit in temp repo
    if (commits.latest) {
        await tempGit.checkout(commits.latest.hash);
    }

    console.log('RepoSync: Live repository updated successfully with complete commit history.');
}
