# DRAFT. Not installed or tested on any Odoo instance. Review field names and Odoo version before use.
{
    "name": "Al Tabeer Traffic Fines",
    "version": "17.0.0.1.0",
    "summary": "Traffic fine records synchronised from the Al Tabeer driver app",
    "depends": ["base", "hr", "fleet"],
    "data": ["security/ir.model.access.csv", "views/fine_views.xml"],
    "license": "LGPL-3",
    "installable": True,
}
