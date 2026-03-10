#!/bin/bash
# Run CodeQL analysis locally (mirrors GitHub's Default Setup)
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
RESULTS_DIR="$ROOT_DIR/.codeql-results"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "🔍 Running CodeQL analysis locally..."
echo ""

# Create results directory
rm -rf "$RESULTS_DIR"
mkdir -p "$RESULTS_DIR"

cd "$ROOT_DIR"

# Analyze JavaScript/TypeScript
echo "📦 Analyzing JavaScript/TypeScript..."
codeql database create "$RESULTS_DIR/js-db" \
    --language=javascript \
    --source-root="$ROOT_DIR" \
    --overwrite \
    2>&1 | grep -E "^(Successfully|Running|Initializing|Finalizing)" || true

echo "  Running security queries..."
codeql database analyze "$RESULTS_DIR/js-db" \
    --format=sarif-latest \
    --output="$RESULTS_DIR/js-results.sarif" \
    codeql/javascript-queries:codeql-suites/javascript-security-and-quality.qls \
    2>&1 | grep -v "^\[" | head -20 || true

# Analyze Python
echo ""
echo "📦 Analyzing Python..."
codeql database create "$RESULTS_DIR/py-db" \
    --language=python \
    --source-root="$ROOT_DIR" \
    --overwrite \
    2>&1 | grep -E "^(Successfully|Running|Initializing|Finalizing)" || true

echo "  Running security queries..."
codeql database analyze "$RESULTS_DIR/py-db" \
    --format=sarif-latest \
    --output="$RESULTS_DIR/py-results.sarif" \
    codeql/python-queries:codeql-suites/python-security-and-quality.qls \
    2>&1 | grep -v "^\[" | head -20 || true

echo ""
echo "📊 Results:"
echo "==========="

# Parse and display results
HAS_ERRORS=false

for sarif in "$RESULTS_DIR"/*.sarif; do
    [ -f "$sarif" ] || continue
    lang=$(basename "$sarif" | sed 's/-results.sarif//')
    
    # Count results by severity
    errors=$(jq '[.runs[].results[] | select(.level == "error")] | length' "$sarif" 2>/dev/null || echo 0)
    warnings=$(jq '[.runs[].results[] | select(.level == "warning")] | length' "$sarif" 2>/dev/null || echo 0)
    
    echo ""
    echo "[$lang]"
    
    if [ "$errors" -gt 0 ]; then
        echo -e "  ${RED}✗ Errors: $errors${NC}"
        HAS_ERRORS=true
        
        # Show error details
        jq -r '.runs[].results[] | select(.level == "error") | "    → \(.ruleId): \(.locations[0].physicalLocation.artifactLocation.uri | gsub(".*/"; "")):\(.locations[0].physicalLocation.region.startLine)"' "$sarif" 2>/dev/null || true
    fi
    
    if [ "$warnings" -gt 0 ]; then
        echo -e "  ${YELLOW}⚠ Warnings: $warnings${NC}"
        
        # Show warning details (first 5)
        jq -r '.runs[].results[] | select(.level == "warning") | "    → \(.ruleId): \(.locations[0].physicalLocation.artifactLocation.uri | gsub(".*/"; "")):\(.locations[0].physicalLocation.region.startLine)"' "$sarif" 2>/dev/null | head -5 || true
    fi
    
    if [ "$errors" -eq 0 ] && [ "$warnings" -eq 0 ]; then
        echo -e "  ${GREEN}✓ No issues found${NC}"
    fi
done

echo ""
echo "==========="

if [ "$HAS_ERRORS" = true ]; then
    echo -e "${RED}✗ Analysis found errors that would fail CI${NC}"
    exit 1
else
    echo -e "${GREEN}✓ Analysis passed - should pass GitHub CI${NC}"
    exit 0
fi
