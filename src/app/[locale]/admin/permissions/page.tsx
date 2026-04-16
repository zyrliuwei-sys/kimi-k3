"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataTable, type Column } from "@/components/data-table";

interface Permission {
  id: string;
  code: string;
  resource: string;
  action: string;
  title: string;
}

const PAGE_SIZE = 10;

const emptyForm = { code: "", resource: "", action: "", title: "" };

export default function PermissionsPage() {
  const t = useTranslations("admin");
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  // Create
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  // Edit
  const [editingPerm, setEditingPerm] = useState<Permission | null>(null);
  const [editForm, setEditForm] = useState(emptyForm);

  // Delete
  const [deletingPerm, setDeletingPerm] = useState<Permission | null>(null);

  const fetchPermissions = useCallback((p: number) => {
    fetch(`/api/admin/permissions?page=${p}&pageSize=${PAGE_SIZE}`)
      .then((r) => r.json())
      .then((res) => {
        if (res.code === 0) {
          setPermissions(res.data.items);
          setTotal(res.data.total);
        }
      });
  }, []);

  useEffect(() => {
    fetchPermissions(page);
  }, [page, fetchPermissions]);

  async function handleCreate() {
    if (!form.code.trim() || !form.resource.trim() || !form.action.trim() || !form.title.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/permissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (data.code === 0) {
        toast.success(t("permissions.created"));
        setCreateOpen(false);
        setForm(emptyForm);
        fetchPermissions(page);
      } else {
        toast.error(data.message);
      }
    } catch {
      toast.error("Failed");
    } finally {
      setSaving(false);
    }
  }

  function openEdit(p: Permission) {
    setEditForm({ code: p.code, resource: p.resource, action: p.action, title: p.title });
    setEditingPerm(p);
  }

  async function handleEdit() {
    if (!editingPerm || !editForm.code.trim() || !editForm.title.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/permissions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingPerm.id, ...editForm }),
      });
      const data = await res.json();
      if (data.code === 0) {
        toast.success(t("permissions.updated"));
        setEditingPerm(null);
        fetchPermissions(page);
      } else {
        toast.error(data.message);
      }
    } catch {
      toast.error("Failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deletingPerm) return;
    try {
      const res = await fetch(`/api/admin/permissions?id=${deletingPerm.id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.code === 0) {
        toast.success(t("permissions.deleted"));
        setDeletingPerm(null);
        fetchPermissions(page);
      } else {
        toast.error(data.message);
      }
    } catch {
      toast.error("Failed");
    }
  }

  const columns: Column<Permission>[] = [
    {
      header: t("permissions.code_col"),
      cell: (p) => <span className="font-mono text-sm">{p.code}</span>,
    },
    {
      header: t("permissions.resource_col"),
      cell: (p) => <span className="font-medium">{p.resource}</span>,
    },
    {
      header: t("permissions.action_col"),
      cell: (p) => p.action,
    },
    {
      header: t("permissions.title_col"),
      cell: (p) => <span className="text-muted-foreground">{p.title}</span>,
    },
    {
      header: t("permissions.actions_col"),
      className: "w-[80px]",
      cell: (p) => (
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" className="size-7" onClick={() => openEdit(p)}>
            <Pencil className="size-3" />
          </Button>
          <Button variant="ghost" size="icon" className="size-7" onClick={() => setDeletingPerm(p)}>
            <Trash2 className="size-3" />
          </Button>
        </div>
      ),
    },
  ];

  function renderFormFields(
    values: typeof emptyForm,
    onChange: (v: typeof emptyForm) => void
  ) {
    return (
      <div className="space-y-4 py-4">
        <div className="space-y-2">
          <Label>{t("permissions.code_field")}</Label>
          <Input value={values.code} onChange={(e) => onChange({ ...values, code: e.target.value })} placeholder={t("permissions.code_placeholder")} />
        </div>
        <div className="space-y-2">
          <Label>{t("permissions.resource_field")}</Label>
          <Input value={values.resource} onChange={(e) => onChange({ ...values, resource: e.target.value })} placeholder={t("permissions.resource_placeholder")} />
        </div>
        <div className="space-y-2">
          <Label>{t("permissions.action_field")}</Label>
          <Input value={values.action} onChange={(e) => onChange({ ...values, action: e.target.value })} placeholder={t("permissions.action_placeholder")} />
        </div>
        <div className="space-y-2">
          <Label>{t("permissions.title_field")}</Label>
          <Input value={values.title} onChange={(e) => onChange({ ...values, title: e.target.value })} placeholder={t("permissions.title_placeholder")} />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("permissions.title")}</h1>
          <p className="text-muted-foreground">{t("permissions.description")}</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger className="inline-flex items-center justify-center rounded-lg bg-primary text-primary-foreground text-sm font-medium h-8 gap-1.5 px-2.5 hover:bg-primary/80 transition-colors">
            <Plus className="size-4" />
            {t("permissions.create_permission")}
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("permissions.create_title")}</DialogTitle>
              <DialogDescription>{t("permissions.create_description")}</DialogDescription>
            </DialogHeader>
            {renderFormFields(form, setForm)}
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>{t("permissions.cancel")}</Button>
              <Button onClick={handleCreate} disabled={saving}>{t("permissions.save")}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("permissions.all_permissions")}</CardTitle>
          <CardDescription>{t("permissions.count", { count: total })}</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={permissions}
            total={total}
            page={page}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
            rowKey={(p) => p.id}
            emptyText={t("permissions.no_permissions")}
          />
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={!!editingPerm} onOpenChange={(v) => !v && setEditingPerm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("permissions.edit_title")}</DialogTitle>
            <DialogDescription>{t("permissions.edit_description")}</DialogDescription>
          </DialogHeader>
          {renderFormFields(editForm, setEditForm)}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingPerm(null)}>{t("permissions.cancel")}</Button>
            <Button onClick={handleEdit} disabled={saving}>{t("permissions.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={!!deletingPerm} onOpenChange={(v) => !v && setDeletingPerm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("permissions.delete_title")}</DialogTitle>
            <DialogDescription>{t("permissions.delete_confirm")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingPerm(null)}>{t("permissions.cancel")}</Button>
            <Button variant="destructive" onClick={handleDelete}>{t("permissions.confirm_delete")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
