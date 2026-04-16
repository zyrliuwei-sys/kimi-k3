"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Shield } from "lucide-react";
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
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { DataTable, type Column } from "@/components/data-table";

interface User {
  id: string;
  name: string;
  email: string;
  image: string | null;
  createdAt: string;
}

interface RoleInfo {
  id: string;
  name: string;
  title: string;
}

interface UserRoleInfo {
  roleId: string;
  roleName: string;
  roleTitle: string;
}

const PAGE_SIZE = 10;

export default function UsersPage() {
  const t = useTranslations("admin");
  const [users, setUsers] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  // Role management dialog
  const [managingUser, setManagingUser] = useState<User | null>(null);
  const [allRoles, setAllRoles] = useState<RoleInfo[]>([]);
  const [userRoleIds, setUserRoleIds] = useState<Set<string>>(new Set());
  const [toggling, setToggling] = useState<string | null>(null);

  const fetchUsers = useCallback((p: number) => {
    fetch(`/api/admin/users?page=${p}&pageSize=${PAGE_SIZE}`)
      .then((r) => r.json())
      .then((res) => {
        if (res.code === 0) {
          setUsers(res.data.items);
          setTotal(res.data.total);
        }
      });
  }, []);

  useEffect(() => {
    fetchUsers(page);
  }, [page, fetchUsers]);

  async function openRoleDialog(u: User) {
    setManagingUser(u);
    const [rolesRes, userRolesRes] = await Promise.all([
      fetch("/api/admin/roles?page=1&pageSize=999").then((r) => r.json()),
      fetch(`/api/admin/roles?userId=${u.id}`).then((r) => r.json()),
    ]);
    if (rolesRes.code === 0) {
      setAllRoles(rolesRes.data.items);
    }
    if (userRolesRes.code === 0) {
      setUserRoleIds(new Set(userRolesRes.data.map((r: UserRoleInfo) => r.roleId)));
    }
  }

  async function toggleRole(roleId: string) {
    if (!managingUser || toggling) return;
    setToggling(roleId);
    const hasRole = userRoleIds.has(roleId);

    try {
      if (hasRole) {
        const res = await fetch(
          `/api/admin/roles/assign?userId=${managingUser.id}&roleId=${roleId}`,
          { method: "DELETE" }
        );
        const data = await res.json();
        if (data.code === 0) {
          setUserRoleIds((prev) => {
            const next = new Set(prev);
            next.delete(roleId);
            return next;
          });
          toast.success(t("users.role_removed"));
        } else {
          toast.error(data.message);
        }
      } else {
        const res = await fetch("/api/admin/roles/assign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: managingUser.id, roleId }),
        });
        const data = await res.json();
        if (data.code === 0) {
          setUserRoleIds((prev) => new Set(prev).add(roleId));
          toast.success(t("users.role_assigned"));
        } else {
          toast.error(data.message);
        }
      }
    } catch {
      toast.error("Failed");
    } finally {
      setToggling(null);
    }
  }

  const columns: Column<User>[] = [
    {
      header: t("users.user_col"),
      cell: (u) => (
        <div className="flex items-center gap-3">
          <Avatar className="size-8">
            <AvatarImage src={u.image || undefined} />
            <AvatarFallback className="text-xs">
              {(u.name || u.email).charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <span className="font-medium">{u.name || "—"}</span>
        </div>
      ),
    },
    {
      header: t("users.email_col"),
      cell: (u) => u.email,
    },
    {
      header: t("users.joined_col"),
      cell: (u) => (
        <span className="text-muted-foreground">
          {new Date(u.createdAt).toLocaleDateString()}
        </span>
      ),
    },
    {
      header: t("users.actions_col"),
      className: "w-[80px]",
      cell: (u) => (
        <Button variant="ghost" size="icon" className="size-7" onClick={() => openRoleDialog(u)}>
          <Shield className="size-3" />
        </Button>
      ),
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("users.title")}</h1>
        <p className="text-muted-foreground">{t("users.description")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("users.all_users")}</CardTitle>
          <CardDescription>{t("users.count", { count: total })}</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={users}
            total={total}
            page={page}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
            rowKey={(u) => u.id}
            emptyText={t("users.no_users")}
          />
        </CardContent>
      </Card>

      {/* Role Management Dialog */}
      <Dialog open={!!managingUser} onOpenChange={(v) => !v && setManagingUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("users.manage_roles_title")}</DialogTitle>
            <DialogDescription>{t("users.manage_roles_description")}</DialogDescription>
          </DialogHeader>
          <div className="max-h-64 overflow-y-auto space-y-3 py-4">
            {allRoles.map((r) => (
              <label key={r.id} className="flex items-center gap-3 cursor-pointer">
                <Checkbox
                  checked={userRoleIds.has(r.id)}
                  onCheckedChange={() => toggleRole(r.id)}
                  disabled={toggling === r.id}
                />
                <div>
                  <div className="text-sm font-medium">{r.title}</div>
                  <div className="text-xs text-muted-foreground font-mono">{r.name}</div>
                </div>
              </label>
            ))}
            {allRoles.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">{t("roles.no_roles")}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setManagingUser(null)}>{t("roles.cancel")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
