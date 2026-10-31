from odoo import fields, models


class AltabeerFine(models.Model):
    _name = "altabeer.fine"
    _description = "Traffic fine (synced from the Al Tabeer app)"
    _order = "violation_at desc, id desc"

    name = fields.Char("Fine reference", required=True, index=True)
    # The app's own ID. Unique so repeated syncs can never create duplicates.
    app_id = fields.Char("App ID", required=True, index=True, copy=False)
    authority = fields.Char("Issuing authority")
    plate = fields.Char("Plate as printed")
    violation_at = fields.Datetime("Violation (UTC)")
    notice_received_at = fields.Datetime("Notice received (UTC)")
    vehicle_id = fields.Many2one("fleet.vehicle", string="Vehicle")
    driver_id = fields.Many2one("hr.employee", string="Driver at violation time")
    vendor_id = fields.Many2one("res.partner", string="Vendor")
    amount = fields.Float("Fine amount (AED)")
    penalty = fields.Float("Additional penalty (AED)")
    amount_paid = fields.Float("Verified paid (AED)")
    deadline = fields.Datetime("Verified payment deadline (UTC)")
    deadline_source = fields.Char("Deadline source")
    state = fields.Selection(
        [("approved", "Approved"), ("ack_pending", "Acknowledgement pending"), ("acknowledged", "Acknowledged"),
         ("payment_pending", "Payment pending"), ("paid_awaiting_verification", "Paid, awaiting verification"),
         ("under_review", "Under review"), ("disputed", "Disputed"), ("closed", "Closed")],
        required=True, default="approved", index=True)
    escalation_level = fields.Integer("Escalation level")
    closed_reason = fields.Char("Closed reason")
    description = fields.Char("Violation")
    last_app_sync = fields.Datetime("Last pushed by app")

    _sql_constraints = [("app_id_uniq", "unique(app_id)", "This fine is already recorded.")]
