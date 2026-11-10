# Notion + Presidio PII scanner

**Portfolio prototype | Synthetic example | Prepared November 2026**

This read-only prototype sends text from a selected Notion page to a locally running [Presidio Analyzer](https://data-privacy-stack.github.io/presidio/analyzer/) service and prints a findings summary. It is based on an earlier BMF Notion DLP plan. That plan did not establish that a production integration was running; this repository makes no deployment or compliance claim.


The scanner never writes to Notion. Its output contains entity types, scores, and block IDs, but no matched text. The included page is fictional.


## Why this matters


Teams can accidentally place personal information in shared Notion pages. A detection workflow can help a reviewer find possible exposure, decide whether it is appropriate, and take action. Detection alone does not change Notion permissions or prove that all sensitive content was found.


## What works in this prototype


- Retrieves the children of one explicitly selected Notion page, follows pagination, and reads nested blocks.
- Extracts rich text from common text blocks. It does not read attachments, images, comments, or database properties.
- Calls Presidio's `/analyze` endpoint for each nonempty text block.
- Filters to email, phone, US SSN, and credit card entities with a minimum score of 0.5.
- Emits a JSON summary without raw page text or matched values.
- Requires a loopback Presidio URL so real Notion text is not sent to an arbitrary remote service by accident.


## Run it


Install Node.js 20 or newer. Start a Presidio Analyzer service locally and confirm that `http://127.0.0.1:3000/health` responds. See the [Presidio project](https://github.com/data-privacy-stack/presidio) for installation options.


Scan the synthetic fixture:


    PRESIDIO_URL=http://127.0.0.1:3000 node scanner.mjs --fixture sample-page.json


Scan one Notion page that you explicitly select:


    NOTION_TOKEN=your_integration_token PRESIDIO_URL=http://127.0.0.1:3000 node scanner.mjs --page-id your-page-id


The Notion integration must have read access to that page. Do not put the token in a source file or commit it to GitHub. On Windows PowerShell, set the variables with `$env:NOTION_TOKEN = '...'` and `$env:PRESIDIO_URL = 'http://127.0.0.1:3000'` before running the `node` command.


Example output shape (illustrative, not an observed scan):


    {"status":"review_required","page_id":"demo-page-001","blocks_scanned":2,
     "findings":[{"block_id":"demo-block-001","entity_type":"EMAIL_ADDRESS","score":0.85}]}


## Review workflow


1. A reviewer checks whether each finding is accurate and whether the information belongs on the page.
2. If exposure is inappropriate, the page owner removes or relocates the information and reviews access.
3. The reviewer records the decision and retests the page.


This prototype does not annotate pages, alert Slack, perform scheduled scans, or claim to enforce data loss prevention. Those are possible next iterations after access, privacy, false-positive, and retry behavior are tested with a dedicated demo workspace.


## Verification status


Automated tests cover Notion pagination and nested blocks, the Presidio HTTP request/response contract, and removal of raw PII from output. A live Notion-to-Presidio scan has not been verified. The public case study date is the GitHub publication date, not the date of the earlier Notion plan.


## References


- [Notion: retrieve block children](https://developers.notion.com/reference/get-block-children)
- [Notion: API versioning](https://developers.notion.com/reference/versioning)
- [Presidio Analyzer](https://data-privacy-stack.github.io/presidio/analyzer/)

