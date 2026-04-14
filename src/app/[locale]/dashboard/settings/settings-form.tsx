"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SettingsForm({
  name: initialName,
  email,
}: {
  name: string;
  email: string;
}) {
  const t = useTranslations();
  const [name, setName] = useState(initialName);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    toast.success(t("dashboard.settings.saved"));
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("dashboard.settings.title")}</h1>
        <p className="text-muted-foreground">{t("dashboard.settings.description")}</p>
      </div>

      <Card>
        <form onSubmit={handleSave}>
          <CardHeader>
            <CardTitle>{t("dashboard.settings.profile")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">{t("dashboard.settings.name")}</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">{t("dashboard.settings.email")}</Label>
              <Input id="email" value={email} disabled className="opacity-60" />
            </div>
          </CardContent>
          <CardFooter>
            <Button type="submit">{t("dashboard.settings.save")}</Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
