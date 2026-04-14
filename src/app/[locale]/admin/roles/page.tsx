"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

interface Role {
  id: string;
  name: string;
  title: string;
  description: string | null;
  status: string;
}

export default function RolesPage() {
  const t = useTranslations("admin");
  const [roles, setRoles] = useState<Role[]>([]);

  useEffect(() => {
    fetch("/api/admin/roles")
      .then((r) => r.json())
      .then((res) => {
        if (res.code === 0) setRoles(res.data);
      });
  }, []);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("roles.title")}</h1>
        <p className="text-muted-foreground">{t("roles.description")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("roles.all_roles")}</CardTitle>
          <CardDescription>{t("roles.count", { count: roles.length })}</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("roles.name_col")}</TableHead>
                <TableHead>{t("roles.title_col")}</TableHead>
                <TableHead>{t("roles.status_col")}</TableHead>
                <TableHead>{t("roles.description_col")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {roles.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                    {t("roles.no_roles")}
                  </TableCell>
                </TableRow>
              ) : (
                roles.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-sm">{r.name}</TableCell>
                    <TableCell className="font-medium">{r.title}</TableCell>
                    <TableCell>
                      <Badge variant={r.status === "active" ? "default" : "secondary"}>
                        {r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.description || "—"}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
