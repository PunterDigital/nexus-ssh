import React, { useEffect, useState } from 'react';
import { useSFTPStore } from '../../stores/sftp-store';
import { Button, Checkbox, Dialog } from '../ui';

// ============================================================
// DownloadConflictDialog — a download's file name already exists in the local folder (#5610):
// Overwrite, Keep both ("name (1).ext") or Skip. Closing the dialog skips. In a batch it
// offers to use the same answer for the rest.
// ============================================================

export const DownloadConflictDialog: React.FC = () => {
  const conflict = useSFTPStore((s) => s.downloadConflict);
  const resolve = useSFTPStore((s) => s.resolveDownloadConflict);
  const [applyToRest, setApplyToRest] = useState(false);

  useEffect(() => {
    if (!conflict) setApplyToRest(false);
  }, [conflict]);

  const answer = (action: 'overwrite' | 'keep-both' | 'skip') =>
    resolve({ action, applyToRest });

  return (
    <Dialog
      open={conflict !== null}
      onClose={() => answer('skip')}
      title="File already exists"
      description={
        conflict ? (
          <>
            The local folder already has a file named{' '}
            <strong className="break-all">{conflict.name}</strong>.
          </>
        ) : undefined
      }
      footer={
        <>
          <Button variant="ghost" onClick={() => answer('skip')}>
            Skip
          </Button>
          <Button onClick={() => answer('keep-both')}>Keep both</Button>
          <Button variant="danger" onClick={() => answer('overwrite')}>
            Overwrite
          </Button>
        </>
      }
    >
      {conflict && conflict.remaining > 0 && (
        <Checkbox
          label="Use this answer for other files in this download that already exist"
          checked={applyToRest}
          onChange={(e) => setApplyToRest(e.target.checked)}
        />
      )}
    </Dialog>
  );
};
