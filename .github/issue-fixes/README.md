# GitHub Issues Formatting Fixes

This directory contains properly formatted markdown files for GitHub issues #20-26, which had formatting issues.

## Problems Fixed

The original issues had the following formatting problems:

1. **HTML Entities**: Some issues contained HTML-encoded characters that should be plain text:
   - Issue #22: `&amp;` instead of `&` in "Metadata & Audit"
   - Issue #24: `&lt;` instead of `<` in `health.battery_level < 20%`
   - Issue #25: `&amp;` instead of `&` in URL parameters like `device_id=[id]&limit=100`

2. **Spacing and Structure**: Issues needed better spacing between sections for improved readability.

3. **Markdown Formatting**: Ensured proper markdown formatting with:
   - Blank lines between sections
   - Proper heading hierarchy
   - Consistent list formatting
   - Proper code block formatting

## Files

- `issue-20.md` - 3.5: Readings Ingest Endpoint (Bulk Insert)
- `issue-21.md` - 3.7: Energy Analytics Endpoint
- `issue-22.md` - 3.2-3.11: Remaining V2 API Endpoints
- `issue-23.md` - 4.1-4.2: V2 API Client & Main Dashboard
- `issue-24.md` - 4.3-4.5: Update Grid, FloorPlan & AnomalyChart
- `issue-25.md` - 4.6-4.9: Create New Dashboard Components
- `issue-26.md` - 5.1: Implement Rate Limiting (HIGH PRIORITY)

## How to Update the Issues

### Option 1: Using GitHub Actions (Recommended)

A GitHub Actions workflow has been created to automatically update all issues:

1. Go to the Actions tab in your repository
2. Select "Fix GitHub Issues Formatting" workflow
3. Click "Run workflow"
4. The workflow will update all issues #20-26 automatically

### Option 2: Using the Bash Script

You can use the provided script to update all issues at once:

```bash
# Generate a GitHub personal access token with 'repo' scope at:
# https://github.com/settings/tokens

# Run the update script
./update-issues.sh YOUR_GITHUB_TOKEN [REPO_OWNER] [REPO_NAME]

# Example:
./update-issues.sh ghp_xxxxxxxxxxxxx
# or for a different repo:
./update-issues.sh ghp_xxxxxxxxxxxxx my-org my-repo
```

The script checks for `jq` installation and provides helpful error messages.

### Option 3: Manual Update

Copy the content from each markdown file and paste it into the corresponding GitHub issue's edit box.

## Changes Made

### Issue #20
- Fixed spacing between sections
- Ensured proper code block formatting
- Added blank lines for better readability

### Issue #21
- Fixed spacing between sections
- Ensured proper list formatting
- Added blank lines for better readability

### Issue #22
- **Fixed**: Changed `&amp;` to `&` in "Metadata & Audit" heading
- Added blank lines between sections
- Improved list formatting

### Issue #23
- Fixed spacing in components section
- Ensured proper heading hierarchy
- Added blank lines for better readability

### Issue #24
- **Fixed**: Changed `&lt;` to `<` in `health.battery_level < 20%`
- Fixed spacing between sections
- Improved list formatting

### Issue #25
- **Fixed**: Changed `&amp;` to `&` in `/api/v2/readings?device_id=[id]&limit=100`
- Fixed spacing between sections
- Improved list formatting for multiple components

### Issue #26
- Fixed spacing between sections
- Improved list formatting
- Added blank lines for better readability

## Verification

After updating, verify the issues display correctly at:
- https://github.com/Amadou-dot/infrasight/issues/20
- https://github.com/Amadou-dot/infrasight/issues/21
- https://github.com/Amadou-dot/infrasight/issues/22
- https://github.com/Amadou-dot/infrasight/issues/23
- https://github.com/Amadou-dot/infrasight/issues/24
- https://github.com/Amadou-dot/infrasight/issues/25
- https://github.com/Amadou-dot/infrasight/issues/26
