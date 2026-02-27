# Commit Command

Commit the current changes with a descriptive commit message.

## Instructions

1. Run `git status` to see all changed and untracked files (do NOT use -uall flag)
2. Run `git diff --staged` and `git diff` to understand what has changed
3. Run `git log --oneline -5` to see recent commit message style in this repo

4. Based on the changes, create a concise but descriptive commit message that:
   - Starts with a type prefix: `feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `test:`, or `style:`
   - Summarizes the "why" not just the "what"
   - Is 1-2 sentences maximum
   - Follows the style of recent commits in this repo

5. Stage the relevant files using `git add <specific files>` (prefer specific files over `git add .`)

6. Create the commit using:
```bash
git commit -m "your commit message here"
```

## CRITICAL RULES

- **NEVER** add `Co-Authored-By` to commit messages
- **NEVER** add any attribution lines to Claude, AI, or any assistant
- The commit message should be clean and only contain the description of changes
- Do not add any footer or trailer lines

## Optional Arguments

If the user provides `$ARGUMENTS`, use them as hints for what files to commit or what the commit should focus on.
