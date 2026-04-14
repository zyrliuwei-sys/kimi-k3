"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { SettingsForm } from "./settings-form";

export default function SettingsPage() {
  const t = useTranslations();
  const [user, setUser] = useState<{ name: string; email: string } | null>(null);

  useEffect(() => {
    fetch("/api/user/info")
      .then((r) => r.json())
      .then((res) => {
        if (res.code === 0) {
          setUser({ name: res.data.name || "", email: res.data.email || "" });
        }
      })
      .catch(() => {});
  }, []);

  if (!user) {
    return (
      <div className="p-6 text-muted-foreground">{t("dashboard.settings.loading")}</div>
    );
  }

  return <SettingsForm name={user.name} email={user.email} />;
}
