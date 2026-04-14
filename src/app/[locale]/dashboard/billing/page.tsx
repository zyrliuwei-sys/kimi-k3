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

export default function BillingPage() {
  const t = useTranslations();
  const [credits, setCredits] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/credits")
      .then((r) => r.json())
      .then((res) => {
        if (res.code === 0) setCredits(res.data.balance);
      })
      .catch(() => {});
  }, []);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("dashboard.billing.title")}</h1>
        <p className="text-muted-foreground">
          {t("dashboard.billing.description")}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("dashboard.billing.credits")}</CardTitle>
          <CardDescription>{t("dashboard.billing.credits_description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold">
            {credits !== null ? credits : "..."}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
