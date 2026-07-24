# SRX - Sales Reconciliation eXpert

SRX reproduces the supplied user interface and turns its **Reconcile** button into the monthly invoice-reconciliation workflow.

## What it does

- Lets the user select the Source Invoice, Raised Invoice, and Paid Invoice folders.
- Reads text-based PDFs in the browser and uses OCR for scanned pages.
- Reconciles transactions with `gemini-3.6-flash`.
- Shows discrepancies for human clarification.
- Produces the interactive AL-TAJ monthly sales report.
- Keeps the Gemini API key on the local server rather than exposing it in browser code.

## Run

1. Copy `.env.example` to `.env`.
2. Add your Gemini API key to `.env`.
3. Run `npm start`.
4. Open `http://127.0.0.1:4173` in Chrome or Edge.
5. Enter the reporting month, select all three invoice folders, and press **Reconcile**.

Chrome or Edge is required because the UI uses the File System Access API for folder selection and saving reports.
