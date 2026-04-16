"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, KeyRound } from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/data-table";

interface Role {
  id: string;
  name: string;
  title: string;
  description: string | null;
  status: string;
}

interface Permission {
  id: string;
  code: string;
  title: string;
}

const PAGE_SIZE = 10;

export default function RolesPage() {
  const t = useTranslations("admin");
  const [roles, setRoles] = useState<Role[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: "", title: "", description: "" });
  const [saving, setSaving] = useState(false);

  // Edit dialog
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [editForm, setEditForm] = useState({ name: "", title: "", description: "" });

  // Delete dialog
  const [deletingRole, setDeletingRole] = useState<Role | null>(null);

  // Permissions dialog
  const [permRole, setPermRole] = useState<Role | null>(null);
  const [allPermissions, setAllPermissions] = useState<Permission[]>([]);
  const [assignedPermIds, setAssignedPermIds] = useState<Set<string>>(new Set());
  const [permSaving, setPermSaving] = useState(false);

  const fetchRoles = useCallback((p: number) => {
    fetch(`/api/admin/roles?page=${p}&pageSize=${PAGE_SIZE}`)
      .then((r) => r.json())
      .then((res) => {
        if (res.code === 0) {
          setRoles(res.data.items);
          setTotal(res.data.total);
        }
      });
  }, []);

  useEffect(() => {
    fetchRoles(page);
  }, [page, fetchRoles]);

  // Create
  async function handleCreate() {
    if (!form.name.trim() || !form.title.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (data.code === 0) {
        toast.success(t("roles.created"));
        setCreateOpen(false);
        setForm({ name: "", title: "", description: "" });
        fetchRoles(page);
      } else {
        toast.error(data.message);
      }
    } catch {
      toast.error("Failed");
    } finally {
      setSaving(false);
    }
  }

  // Edit
  function openEdit(r: Role) {
    setEditForm({ name: r.name, title: r.title, description: r.description || "" });
    setEditingRole(r);
  }

  async function handleEdit() {
    if (!editingRole || !editForm.name.trim() || !editForm.title.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/roles", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingRole.id, ...editForm }),
      });
      const data = await res.json();
      if (data.code === 0) {
        toast.success(t("roles.updated"));
        setEditingRole(null);
        fetchRoles(page);
      } else {
        toast.error(data.message);
      }
    } catch {
      toast.error("Failed");
    } finally {
      setSaving(false);
    }
  }

  // Delete
  async function handleDelete() {
    if (!deletingRole) return;
    try {
      const res = await fetch(`/api/admin/roles?id=${deletingRole.id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.code === 0) {
        toast.success(t("roles.deleted"));
        setDeletingRole(null);
        fetchRoles(page);
      } else {
        toast.error(data.message);
      }
    } catch {
      toast.error("Failed");
    }
  }

  // Permissions
  async function openPermissions(r: Role) {
    setPermRole(r);
    const [permsRes, assignedRes] = await Promise.all([
      fetch("/api/admin/permissions?page=1&pageSize=999").then((r) => r.json()),
      fetch(`/api/admin/roles/permissions?roleId=${r.id}`).then((r) => r.json()),
    ]);
    if (permsRes.code === 0) setAllPermissions(permsRes.data.items);
    if (assignedRes.code === 0) {
      setAssignedPermIds(new Set(assignedRes.data.map((p: any) => p.permissionId)));
    }
  }

  function togglePermission(permId: string) {
    setAssignedPermIds((prev) => {
      const next = new Set(prev);
      if (next.has(permId)) next.delete(permId);
      else next.add(permId);
      return next;
    });
  }

  async function handleSavePermissions() {
    if (!permRole) return;
    setPermSaving(true);
    try {
      const res = await fetch("/api/admin/roles/permissions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roleId: permRole.id, permissionIds: [...assignedPermIds] }),
      });
      const data = await res.json();
      if (data.code === 0) {
        toast.success(t("roles.permissions_saved"));
        setPermRole(null);
      } else {
        toast.error(data.message);
      }
    } catch {
      toast.error("Failed");
    } finally {
      setPermSaving(false);
    }
  }

  const columns: Column<Role>[] = [
    {
      header: t("roles.name_col"),
      cell: (r) => <span className="font-mono text-sm">{r.name}</span>,
    },
    {
      header: t("roles.title_col"),
      cell: (r) => <span className="font-medium">{r.title}</span>,
    },
    {
      header: t("roles.description_col"),
      cell: (r) => (
        <span className="text-muted-foreground">{r.description || "—"}</span>
      ),
    },
    {
      header: t("roles.actions_col"),
      className: "w-[120px]",
      cell: (r) => (
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" className="size-7" onClick={() => openPermissions(r)}>
            <KeyRound className="size-3" />
          </Button>
          <Button variant="ghost" size="icon" className="size-7" onClick={() => openEdit(r)}>
            <Pencil className="size-3" />
          </Button>
          <Button variant="ghost" size="icon" className="size-7" onClick={() => setDeletingRole(r)}>
            <Trash2 className="size-3" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("roles.title")}</h1>
          <p className="text-muted-foreground">{t("roles.description")}</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger className="inline-flex items-center justify-center rounded-lg bg-primary text-primary-foreground text-sm font-medium h-8 gap-1.5 px-2.5 hover:bg-primary/80 transition-colors">
            <Plus className="size-4" />
            {t("roles.create_role")}
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("roles.create_title")}</DialogTitle>
              <DialogDescription>{t("roles.create_description")}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>{t("roles.name_field")}</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t("roles.name_placeholder")} />
              </div>
              <div className="space-y-2">
                <Label>{t("roles.title_field")}</Label>
                <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={t("roles.title_placeholder")} />
              </div>
              <div className="space-y-2">
                <Label>{t("roles.description_field")}</Label>
                <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder={t("roles.description_placeholder")} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>{t("roles.cancel")}</Button>
              <Button onClick={handleCreate} disabled={saving}>{t("roles.save")}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("roles.all_roles")}</CardTitle>
          <CardDescription>{t("roles.count", { count: total })}</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={roles}
            total={total}
            page={page}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
            rowKey={(r) => r.id}
            emptyText={t("roles.no_roles")}
          />
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={!!editingRole} onOpenChange={(v) => !v && setEditingRole(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("roles.edit_title")}</DialogTitle>
            <DialogDescription>{t("roles.edit_description")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>{t("roles.name_field")}</Label>
              <Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} placeholder={t("roles.name_placeholder")} />
            </div>
            <div className="space-y-2">
              <Label>{t("roles.title_field")}</Label>
              <Input value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} placeholder={t("roles.title_placeholder")} />
            </div>
            <div className="space-y-2">
              <Label>{t("roles.description_field")}</Label>
              <Input value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} placeholder={t("roles.description_placeholder")} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingRole(null)}>{t("roles.cancel")}</Button>
            <Button onClick={handleEdit} disabled={saving}>{t("roles.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={!!deletingRole} onOpenChange={(v) => !v && setDeletingRole(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("roles.delete_title")}</DialogTitle>
            <DialogDescription>{t("roles.delete_confirm")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingRole(null)}>{t("roles.cancel")}</Button>
            <Button variant="destructive" onClick={handleDelete}>{t("roles.confirm_delete")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Permissions Dialog */}
      <Dialog open={!!permRole} onOpenChange={(v) => !v && setPermRole(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("roles.manage_permissions_title")}</DialogTitle>
            <DialogDescription>{t("roles.manage_permissions_description")}</DialogDescription>
          </DialogHeader>
          <div className="max-h-64 overflow-y-auto space-y-3 py-4">
            {allPermissions.map((perm) => (
              <label key={perm.id} className="flex items-center gap-3 cursor-pointer">
                <Checkbox
                  checked={assignedPermIds.has(perm.id)}
                  onCheckedChange={() => togglePermission(perm.id)}
                />
                <div>
                  <div className="text-sm font-medium">{perm.title}</div>
                  <div className="text-xs text-muted-foreground font-mono">{perm.code}</div>
                </div>
              </label>
            ))}
            {allPermissions.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">{t("permissions.no_permissions")}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPermRole(null)}>{t("roles.cancel")}</Button>
            <Button onClick={handleSavePermissions} disabled={permSaving}>{t("roles.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
