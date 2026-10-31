// Throwaway probe, row 011-288: times each held report from the end of its delivery's
// transaction body (its first savepoint after the hold, where it committed before) to its
// COMMIT, appending `<ms>` lines to `$SQUEAL_LOCK_LOG` while it is set. Imported by the
// probe itself and by the Pi and OpenCode bundles it builds.
import { appendFileSync } from "node:fs";
import { HoldingConnection } from "../../../../../../src/core/delivery/held-connection.js";

const proto = HoldingConnection.prototype;
const hold = proto.hold;
proto.hold = function patched(this: HoldingConnection) {
  const held = hold.call(this);
  if (held === null) return held;
  const self = this as unknown as { transaction: HoldingConnection["transaction"] };
  let bodyEnd: number | null = null;
  self.transaction = <T>(fn: () => T): T => {
    const result = proto.transaction.call(this, fn) as T;
    bodyEnd ??= performance.now();
    return result;
  };
  const end = () => {
    delete (self as { transaction?: unknown }).transaction;
  };
  const { commit, rollback } = held;
  return {
    commit: () => {
      commit();
      end();
      const log = process.env.SQUEAL_LOCK_LOG;
      if (bodyEnd !== null && log) appendFileSync(log, `${(performance.now() - bodyEnd).toFixed(3)}\n`);
    },
    rollback: () => {
      rollback();
      end();
    },
  };
};
