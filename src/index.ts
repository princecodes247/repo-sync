import * as fs from 'fs-extra';
import * as path from 'node:path';
import * as crypto from 'crypto';
import simpleGit, { SimpleGit, SimpleGitOptions } from 'simple-git';
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
            const commitMessage = await getLastCommitMessage(paths.TEMP_CLONE_PATH);
            copyFilesToLive(paths.TEMP_CLONE_PATH, paths.LIVE_REPO_PATH);
            await updateLiveRepo(commitMessage, paths.LIVE_REPO_PATH);
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
    let TEMP_CLONE_PATH = path.resolve(liveRepoPath + '_temp');
    let LIVE_REPO_PATH = path.resolve(liveRepoPath);

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

async function updateLiveRepo(commitMessage: string, livePath: string) {
    if (!fs.existsSync(livePath)) {
        fs.mkdirSync(livePath);
    }
    const liveGit = simpleGit(livePath);

    if (!(await liveGit.checkIsRepo())) {
        await liveGit.init()
    }
    await liveGit.add('.');
    await liveGit.commit(commitMessage);
    console.log('RepoSync: Live repository updated and pushed successfully.', commitMessage);
}
