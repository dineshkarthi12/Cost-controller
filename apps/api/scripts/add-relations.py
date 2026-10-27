"""
Adds explicit foreign-key relations to schema.prisma for id columns that do not
already declare one. Run once after editing the schema: python3 scripts/add-relations.py
The script is idempotent: fields that already have a relation are skipped.
"""
import re, sys, pathlib

path = pathlib.Path(__file__).resolve().parent.parent / "prisma" / "schema.prisma"
src = path.read_text()

FIELD_TARGETS = {
    "projectId": "Project",
    "costCodeId": "CostCode",
    "boqItemId": "BoqItem",
    "materialId": "Material",
    "supplierId": "Party",
    "contractorId": "Party",
    "partyId": "Party",
    "payeeId": "Party",
    "counterpartyId": "Party",
    "clientId": "Party",
    "consultantId": "Party",
    "recipientId": "Party",
    "ownerPartyId": "Party",
    "poId": "PurchaseOrder",
    "grnId": "Grn",
    "storeId": "Store",
    "toStoreId": "Store",
    "equipmentId": "Equipment",
    "activityId": "Activity",
    "subcontractId": "Subcontract",
    "mrId": "MaterialRequisition",
    "prId": "PurchaseRequisition",
    "poLineId": "PurchaseOrderLine",
    "fileId": "FileObject",
    "wbsNodeId": "WbsNode",
    "createdById": "User",
    "requestedById": "User",
    "receivedById": "User",
    "uploadedById": "User",
    "projectManagerId": "User",
    "ownerId": "User",
    "contractId": "Contract",
    "clientBillId": "ClientBill",
    "contractorBillId": "ContractorBill",
    "supplierInvoiceId": "SupplierInvoice",
    "milestoneId": "BillingMilestone",
    "definitionId": "WorkflowDefinition",
}
# Models whose columns stay as plain references (append-only logs and caches).
SKIP_MODELS = {"AuditEvent", "Notification", "ImportJob", "IdempotencyKey", "RegisterEntry", "Invitation"}
SKIP_FIELDS = {("Equipment", "currentProjectId")}

model_re = re.compile(r"^model (\w+) \{\n(.*?)^\}", re.S | re.M)
models = {m.group(1): m.group(2) for m in model_re.finditer(src)}
back_refs = {}  # target -> list of lines
new_bodies = {}

for name, body in models.items():
    if name in SKIP_MODELS:
        continue
    lines = body.split("\n")
    existing_rel_fields = set(re.findall(r"@relation\((?:\"[^\"]*\",\s*)?fields:\s*\[(\w+)\]", body))
    field_names = set(re.findall(r"^\s+(\w+)\s", body, re.M))
    additions = []
    for line in lines:
        m = re.match(r"^\s+(\w+)\s+String(\??)\s*(.*)$", line)
        if not m:
            continue
        field, optional = m.group(1), m.group(2) == "?"
        if field not in FIELD_TARGETS or field in existing_rel_fields or (name, field) in SKIP_FIELDS:
            continue
        if "@id" in m.group(3):
            continue
        target = FIELD_TARGETS[field]
        rel_field = field[:-2]
        if rel_field in field_names:
            rel_field = rel_field + "Ref"
        rel_name = f"{name}_{field}"
        q = "?" if optional else ""
        additions.append(f"  {rel_field} {target}{q} @relation(\"{rel_name}\", fields: [{field}], references: [id], onDelete: Restrict)")
        back_refs.setdefault(target, []).append(f"  rel_{name[0].lower()+name[1:]}_{field[:-2]} {name}[] @relation(\"{rel_name}\")")
    if additions:
        new_bodies[name] = body.rstrip("\n") + "\n\n  // generated foreign keys (scripts/add-relations.py)\n" + "\n".join(additions) + "\n"

for target, refs in back_refs.items():
    body = new_bodies.get(target, models[target])
    new_bodies[target] = body.rstrip("\n") + "\n\n  // generated back-relations\n" + "\n".join(refs) + "\n"

def repl(m):
    name = m.group(1)
    if name in new_bodies:
        return f"model {name} {{\n{new_bodies[name]}}}"
    return m.group(0)

out = model_re.sub(repl, src)
path.write_text(out)
print(f"added relations to {len(new_bodies)} models")
