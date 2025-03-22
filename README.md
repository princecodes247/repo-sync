# Repo Sync

A command-line tool to synchronize changes between two Git repositories, specifically designed for maintaining a controlled production repository that receives updates from a development repository.

## Overview

Repo Sync helps manage scenarios where you have:
- A development repository where multiple contributors can push changes
- A production repository where access is restricted to specific maintainers

The tool automatically handles:
- Cloning the development repository
- Copying new and modified files to the production repository
- Maintaining commit history
- Cleaning up temporary files
- Excluding specific files/directories (like .git, node_modules, etc.)

## Installation

```bash
npm install
```

## Usage

### Basic Command

```bash
reposync push <source-repo> <target-repo>
 ```
 Parameters:
- source-repo : Path or URL to the development repository
- target-repo : Path to the production repository Examples:
Using local paths:

```bash
reposync push ./dev-repo ./prod-repo
 ```

Using remote repository:

```bash
reposync push https://github.com/user/dev-repo ./prod-repo
 ```
```

### Options

```bash
reposync push --verbose <source-repo> <target-repo>
 ```

- --verbose : Display additional information during execution

## How It Works

1. Initialization
   - Creates a temporary directory for cloning
   - Sets up Git configuration

2. Development Repository Clone
   - Clones the development repository to a temporary location
   - Retrieves the latest commit message

3. File Synchronization
   - Copies new files from development to production
   - Updates modified files
   - Removes files that no longer exist in development
   - Preserves Git history

4. Production Repository Update
   - Initializes Git repository if needed
   - Commits changes with the original commit message
   - Cleans up temporary files

## Excluded Files/Directories

The following are automatically excluded from synchronization:
- .git directory
- .gitignore file
- node_modules directory
- .next directory

## Error Handling

The tool includes error handling for common scenarios:
- Existing temporary directories
- Repository access issues
- File system operations

## Requirements
- Node.js
- Git
- fs-extra package
- simple-git package

## License

MIT