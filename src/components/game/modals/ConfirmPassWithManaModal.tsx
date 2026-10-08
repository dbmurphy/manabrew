import { Modal } from "./Modal";
import { Button } from "@/components/ui/button";

export function ConfirmPassWithManaModal({
  amount,
  onConfirm,
  onCancel,
}: {
  amount: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal maxWidth="max-w-md" onClose={onCancel}>
      <Modal.Header>
        <h2 className="text-base font-semibold">Pass with unspent mana?</h2>
      </Modal.Header>
      <Modal.Body className="text-sm">
        You have {amount} unspent mana. Mana normally empties as steps and phases end.
      </Modal.Body>
      <Modal.Footer className="justify-between">
        <Modal.Close data-autofocus variant="ghost" onClose={onCancel}>
          Cancel
        </Modal.Close>
        <Button variant="primary" onClick={onConfirm}>
          Pass
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
