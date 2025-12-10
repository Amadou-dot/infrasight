#!/bin/bash
# Script to update GitHub issues #20-26 with properly formatted markdown
# Usage: ./update-issues.sh <GITHUB_TOKEN>

set -e

GITHUB_TOKEN="$1"
REPO_OWNER="Amadou-dot"
REPO_NAME="infrasight"
ISSUE_FIXES_DIR=".github/issue-fixes"

if [ -z "$GITHUB_TOKEN" ]; then
    echo "Error: GitHub token required"
    echo "Usage: $0 <GITHUB_TOKEN>"
    echo ""
    echo "To create a token:"
    echo "1. Go to https://github.com/settings/tokens"
    echo "2. Generate a new token with 'repo' scope"
    echo "3. Run: $0 <your-token>"
    exit 1
fi

echo "Updating GitHub issues #20-26 with properly formatted markdown..."
echo ""

for issue_num in 20 21 22 23 24 25 26; do
    issue_file="${ISSUE_FIXES_DIR}/issue-${issue_num}.md"
    
    if [ ! -f "$issue_file" ]; then
        echo "Warning: File $issue_file not found, skipping issue #${issue_num}"
        continue
    fi
    
    echo "Updating issue #${issue_num}..."
    
    # Read the markdown file content
    body=$(cat "$issue_file")
    
    # Escape the body for JSON
    # Use jq to properly escape the string
    json_body=$(jq -n --arg body "$body" '{body: $body}')
    
    # Update the issue using GitHub API
    response=$(curl -s -w "\n%{http_code}" -X PATCH \
        -H "Authorization: token ${GITHUB_TOKEN}" \
        -H "Accept: application/vnd.github.v3+json" \
        -H "Content-Type: application/json" \
        -d "$json_body" \
        "https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/issues/${issue_num}")
    
    # Get the HTTP status code (last line)
    http_code=$(echo "$response" | tail -n1)
    response_body=$(echo "$response" | sed '$d')
    
    if [ "$http_code" = "200" ]; then
        echo "✓ Issue #${issue_num} updated successfully"
    else
        echo "✗ Failed to update issue #${issue_num} (HTTP ${http_code})"
        echo "Response: $response_body"
    fi
    echo ""
    
    # Be nice to GitHub API
    sleep 1
done

echo "Done! All issues have been processed."
echo ""
echo "Please verify the updates at: https://github.com/${REPO_OWNER}/${REPO_NAME}/issues"
