'use client';

import { useState } from 'react';
import { X } from 'lucide-react';

import { PptWorkspace } from '@/components/ppt-workspace';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * Thin wrapper around PptWorkspace — the dialog just provides the modal
 * chrome (overlay, close button, scroll container) and lets the workspace
 * own the full UX. All state lives inside the workspace.
 */
export function PptGeneratorDialog({ trigger }: { trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger}
      <DialogContent
        showCloseButton={false}
        className="bg-card border-foreground/10 max-h-[92vh] w-full max-w-4xl gap-0 overflow-hidden p-0"
      >
        <Header onClose={() => setOpen(false)} />
        <div className="max-h-[calc(92vh-56px)] overflow-y-auto px-6 py-5">
          <PptWorkspace />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Header({ onClose }: { onClose: () => void }) {
  return (
    <div className="border-foreground/10 bg-card sticky top-0 z-10 flex items-center justify-between border-b px-6 py-3.5">
      <div className="flex items-center gap-2.5">
        <div className="brand-gradient grid size-7 place-items-center rounded-full text-white">
          <span className="text-sm">✨</span>
        </div>
        <DialogTitle className="text-base font-semibold tracking-tight">
          PPT Generator
        </DialogTitle>
      </div>
      <DialogClose
        className="text-foreground/55 hover:text-foreground hover:bg-foreground/5 grid size-7 place-items-center rounded-md transition-colors"
        aria-label="Close"
        onClick={onClose}
      >
        <X className="size-4" />
      </DialogClose>
    </div>
  );
}
