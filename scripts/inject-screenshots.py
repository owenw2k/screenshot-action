#!/usr/bin/env python3
"""
Inject screenshot markdown between <!-- screenshots-start --> and <!-- screenshots-end -->
markers in a PR description.

Reads the current PR body from BODY env var, the screenshot markdown from SCREENSHOTS env var,
and prints the updated body to stdout.
"""

import os
import re

body = os.environ["BODY"]
md = os.environ["SCREENSHOTS"]
repl = "<!-- screenshots-start -->\n" + md + "<!-- screenshots-end -->"

# re.DOTALL makes . match newlines so the pattern captures multi-line screenshot blocks.
result = re.sub(
    r"<!-- screenshots-start -->.*?<!-- screenshots-end -->",
    repl,
    body,
    flags=re.DOTALL,
)
print(result, end="")
