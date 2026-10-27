-- Append-only guarantees enforced by the database, not just by application code.
-- Corrections to the cost ledger and stock ledger are made with reversal entries;
-- audit events and approval actions are never edited or removed.
CREATE OR REPLACE FUNCTION toprock_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only: % is not permitted (post a reversal entry instead)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CostLedgerEntry_append_only" BEFORE UPDATE OR DELETE ON "CostLedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION toprock_reject_mutation();
CREATE TRIGGER "StockTransaction_append_only" BEFORE UPDATE OR DELETE ON "StockTransaction"
  FOR EACH ROW EXECUTE FUNCTION toprock_reject_mutation();
CREATE TRIGGER "AuditEvent_append_only" BEFORE UPDATE OR DELETE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION toprock_reject_mutation();
CREATE TRIGGER "ApprovalAction_append_only" BEFORE UPDATE OR DELETE ON "ApprovalAction"
  FOR EACH ROW EXECUTE FUNCTION toprock_reject_mutation();
