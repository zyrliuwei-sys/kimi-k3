"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Copy, Plus, Trash2 } from "lucide-react";
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

interface ApiKey {
  id: string;
  key: string;
  title: string;
  createdAt: string;
}

const PAGE_SIZE = 10;

export default function ApiKeysPage() {
  const t = useTranslations();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [newKeyName, setNewKeyName] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const fetchKeys = useCallback((p: number) => {
    fetch(`/api/apikeys?page=${p}&pageSize=${PAGE_SIZE}`)
      .then((r) => r.json())
      .then((res) => {
        if (res.code === 0) {
          setKeys(res.data.items);
          setTotal(res.data.total);
        }
      });
  }, []);

  useEffect(() => {
    fetchKeys(page);
  }, [page, fetchKeys]);

  async function handleCreate() {
    if (!newKeyName.trim()) return;
    setLoading(true);
    try {
      const res = await fetch("/api/apikeys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newKeyName }),
      });
      const data = await res.json();
      if (data.code === 0) {
        toast.success(t("dashboard.api_keys.created"));
        await navigator.clipboard.writeText(data.data.key);
        toast.info(t("dashboard.api_keys.key_copied"));
        setOpen(false);
        setNewKeyName("");
        fetchKeys(page);
      } else {
        toast.error(data.message);
      }
    } catch {
      toast.error(t("dashboard.api_keys.failed"));
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/apikeys?id=${id}`, { method: "DELETE" });
    const data = await res.json();
    if (data.code === 0) {
      toast.success(t("dashboard.api_keys.deleted"));
      fetchKeys(page);
    }
  }

  async function handleCopy(key: string) {
    await navigator.clipboard.writeText(key);
    toast.success(t("dashboard.api_keys.copied"));
  }

  const columns: Column<ApiKey>[] = [
    {
      header: t("dashboard.api_keys.name_col"),
      cell: (k) => <span className="font-medium">{k.title}</span>,
    },
    {
      header: t("dashboard.api_keys.key_col"),
      cell: (k) => (
        <span className="font-mono text-xs">{k.key.slice(0, 12)}...</span>
      ),
    },
    {
      header: t("dashboard.api_keys.actions_col"),
      className: "w-[100px]",
      cell: (k) => (
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => handleCopy(k.key)}
          >
            <Copy className="size-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => handleDelete(k.id)}
          >
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
          <h1 className="text-2xl font-bold">{t("dashboard.api_keys.title")}</h1>
          <p className="text-muted-foreground">
            {t("dashboard.api_keys.description")}
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger className="inline-flex items-center justify-center rounded-lg bg-primary text-primary-foreground text-sm font-medium h-8 gap-1.5 px-2.5 hover:bg-primary/80 transition-colors">
            <Plus className="size-4" />
            {t("dashboard.api_keys.create_key")}
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("dashboard.api_keys.create_title")}</DialogTitle>
              <DialogDescription>
                {t("dashboard.api_keys.create_description")}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-4">
              <Label htmlFor="key-name">{t("dashboard.api_keys.key_name")}</Label>
              <Input
                id="key-name"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder={t("dashboard.api_keys.key_name_placeholder")}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                {t("dashboard.api_keys.cancel")}
              </Button>
              <Button onClick={handleCreate} disabled={loading}>
                {loading ? t("dashboard.api_keys.creating") : t("dashboard.api_keys.create")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("dashboard.api_keys.your_keys")}</CardTitle>
          <CardDescription>
            {t("dashboard.api_keys.your_keys_description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={keys}
            total={total}
            page={page}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
            rowKey={(k) => k.id}
            emptyText={t("dashboard.api_keys.no_keys")}
          />
        </CardContent>
      </Card>
    </div>
  );
}
