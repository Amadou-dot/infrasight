# Test Coverage Setup Guide

This guide explains how to enable test coverage reporting and enforcement on pull requests for Infrasight.

## Overview

The test coverage system provides:
- Automated test execution on every PR
- Coverage reports with detailed metrics
- Automatic PR comments with coverage statistics
- Merge blocking if coverage falls below thresholds
- Integration with Codecov for detailed analysis

## Current Coverage Thresholds

As defined in `jest.config.js`:

| Metric | Threshold |
|--------|-----------|
| Statements | 80% |
| Branches | 70% |
| Functions | 75% |
| Lines | 80% |

## Setup Instructions

### 1. Enable GitHub Actions Workflow

The workflow file `.github/workflows/test-coverage.yml` has been created and will automatically run on:
- Pull requests to `main` or `develop` branches
- Direct pushes to `main` or `develop` branches

No additional configuration needed - the workflow is ready to use.

### 2. Configure Codecov (Optional but Recommended)

Codecov provides detailed coverage analysis and historical tracking.

#### Steps:
1. Go to [https://codecov.io/](https://codecov.io/)
2. Sign in with your GitHub account
3. Add the `infrasight` repository
4. Copy the upload token
5. Add it to your repository secrets:
   - Go to: `Settings` → `Secrets and variables` → `Actions`
   - Click `New repository secret`
   - Name: `CODECOV_TOKEN`
   - Value: (paste the token)

**Note:** The workflow will work without Codecov, but you'll miss out on detailed reports and trends.

### 3. Enable Branch Protection Rules

To block merges when coverage falls below thresholds:

#### Steps:
1. Navigate to your repository on GitHub
2. Go to `Settings` → `Branches`
3. Click `Add rule` or edit existing rule for `main` branch
4. Configure the following:

   **Branch name pattern:** `main`

   **Protect matching branches:**
   - ✅ Require a pull request before merging
     - ✅ Require approvals: 1 (recommended)
     - ✅ Dismiss stale pull request approvals when new commits are pushed

   - ✅ Require status checks to pass before merging
     - ✅ Require branches to be up to date before merging
     - **Add required status check:** `test-coverage` (this is the job name from the workflow)

   - ✅ Require conversation resolution before merging (recommended)

   - ✅ Do not allow bypassing the above settings (recommended)

5. Click `Create` or `Save changes`

6. Repeat for `develop` branch if you use it

#### What This Does:
- PRs cannot be merged if tests fail
- PRs cannot be merged if coverage drops below thresholds (80% statements, 70% branches, 75% functions, 80% lines)
- The "Merge" button will be disabled until all checks pass

### 4. Verify Setup

Create a test PR to verify everything works:

```bash
# Create a test branch
git checkout -b test-coverage-setup

# Make a small change (e.g., update README)
echo "Testing coverage setup" >> README.md

# Commit and push
git add README.md
git commit -m "test: verify coverage workflow"
git push origin test-coverage-setup
```

Then:
1. Create a PR from `test-coverage-setup` to `main`
2. Wait for the workflow to complete (usually 2-3 minutes)
3. Check for:
   - ✅ Green checkmark on the PR (tests passed)
   - 📊 Coverage report comment on the PR
   - Coverage metrics in the PR status checks

## Understanding the Coverage Report

The PR comment will show a table like this:

| Metric | Coverage | Threshold | Status |
|--------|----------|-----------|--------|
| 📝 **Statements** | 85% | 80% | ✅ Pass |
| 🌿 **Branches** | 72% | 70% | ✅ Pass |
| 🔧 **Functions** | 78% | 75% | ✅ Pass |
| 📏 **Lines** | 86% | 80% | ✅ Pass |

- **Green ✅**: Coverage meets or exceeds threshold
- **Red ❌**: Coverage below threshold (merge will be blocked)

## Running Tests Locally

Before pushing changes, run tests locally to catch issues:

```bash
# Run all tests with coverage
pnpm test:coverage

# Run specific test suites
pnpm test:unit           # Unit tests only
pnpm test:integration    # Integration tests only

# Watch mode for development
pnpm test:watch
```

Coverage reports are generated in the `/coverage` directory:
- Open `/coverage/lcov-report/index.html` in a browser for detailed local coverage report

## Adjusting Coverage Thresholds

If you need to adjust thresholds, edit `jest.config.js`:

```javascript
coverageThreshold: {
  global: {
    branches: 70,    // Adjust as needed
    functions: 75,   // Adjust as needed
    lines: 80,       // Adjust as needed
    statements: 80,  // Adjust as needed
  },
},
```

**Best Practices:**
- Never lower thresholds to merge code - improve test coverage instead
- Incrementally increase thresholds over time (e.g., 70% → 75% → 80%)
- Review coverage reports to identify untested code paths

## Troubleshooting

### Workflow fails with "CODECOV_TOKEN not found"
- This is a warning only - the workflow will continue
- Add the token (see step 2) to enable Codecov integration

### Coverage drops unexpectedly
- Check which files are uncovered in the PR comment
- Add tests for new code or modified functions
- Run `pnpm test:coverage` locally to see detailed report

### Tests pass locally but fail in CI
- Ensure `.env.local` has all required variables
- Check GitHub Actions logs for specific error messages
- Verify MongoDB Memory Server is starting correctly

### Merge button still enabled despite failing tests
- Branch protection rules may not be configured (see step 3)
- Ensure you selected the correct status check: `test-coverage`
- Wait for all checks to complete before attempting merge

## Additional Resources

- [Jest Coverage Configuration](https://jestjs.io/docs/configuration#coveragethreshold-object)
- [GitHub Branch Protection Rules](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- [Codecov Documentation](https://docs.codecov.com/docs)
- [MongoDB Memory Server](https://github.com/nodkz/mongodb-memory-server)

## Coverage Badge (Optional)

Add a coverage badge to your README.md to show coverage status:

```markdown
[![codecov](https://codecov.io/gh/YOUR_USERNAME/infrasight/branch/main/graph/badge.svg)](https://codecov.io/gh/YOUR_USERNAME/infrasight)
```

Replace `YOUR_USERNAME` with your GitHub username or organization name.
