# Shared Office support

`common.py` validates bounded ZIP/XML and package relationships. `cli_support.py` checks explicit optional dependencies and publishes create-only outputs. Both support the four Office Skills. `convert_pdf.py` is shared by Documents, Spreadsheets and Presentations and uses an installed LibreOffice with a private user directory; it never downloads a converter.

Each Skill pins the required files and hashes in its resource manifest. Activation copies these bytes into its immutable scripts directory. Format-specific modules live inside their own Skill; PDF parsing safety is shared with the native page viewer from `utils/document-view/pdf_safety.py`.

These helpers do not dispatch model tools or grant command permissions. Authorized workspace scripts can call public Python libraries or these functions; helper validation does not constrain arbitrary authorized shell code.
