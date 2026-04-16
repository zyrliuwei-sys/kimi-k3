"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  getSettingTabs,
  getSettingGroups,
  getSettings,
  type Setting,
} from "@/modules/config/settings";

export default function AdminSettingsPage() {
  const t = useTranslations("admin");
  const [configs, setConfigs] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState("general");
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const tabs = getSettingTabs();
  const groups = getSettingGroups();
  const settings = getSettings();

  useEffect(() => {
    fetch("/api/admin/config")
      .then((r) => r.json())
      .then((res) => {
        if (res.code === 0) setConfigs(res.data);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  function handleChange(name: string, value: string) {
    setConfigs((prev) => ({ ...prev, [name]: value }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const tabSettings = settings.filter((s) => s.tab === activeTab);
      const toSave: Record<string, string> = {};
      for (const s of tabSettings) {
        if (configs[s.name] !== undefined) {
          toSave[s.name] = configs[s.name];
        }
      }

      const res = await fetch("/api/admin/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toSave),
      });
      const data = await res.json();
      if (data.code === 0) {
        toast.success(t("settings.save_success"));
      } else {
        toast.error(data.message);
      }
    } catch {
      toast.error(t("settings.save_error"));
    } finally {
      setSaving(false);
    }
  }

  const tabGroups = groups.filter((g) => g.tab === activeTab);
  const tabSettings = settings.filter((s) => s.tab === activeTab);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("settings.title")}</h1>
          <p className="text-muted-foreground">{t("settings.description")}</p>
        </div>
        <Button onClick={handleSave} disabled={saving} className="gap-2">
          <Save className="size-4" />
          {saving ? t("settings.saving") : t("settings.save")}
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.name}
            onClick={() => setActiveTab(tab.name)}
            className={cn(
              "px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px",
              activeTab === tab.name
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t(`settings.tabs.${tab.name}`)}
          </button>
        ))}
      </div>

      {/* Groups */}
      {!loaded ? (
        <div className="text-muted-foreground">{t("loading")}</div>
      ) : (
        tabGroups.map((group) => {
          const groupSettings = tabSettings.filter((s) => s.group === group.name);
          if (groupSettings.length === 0) return null;

          return (
            <Card key={group.name}>
              <CardHeader>
                <CardTitle>{t(`settings.groups.${group.name}.title`)}</CardTitle>
                {group.description && (
                  <CardDescription>{t(`settings.groups.${group.name}.description`)}</CardDescription>
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                {groupSettings.map((setting) => (
                  <SettingField
                    key={setting.name}
                    setting={setting}
                    label={t(`settings.fields.${setting.name}`)}
                    value={configs[setting.name] || ""}
                    onChange={(v) => handleChange(setting.name, v)}
                  />
                ))}
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}

function SettingField({
  setting,
  label,
  value,
  onChange,
}: {
  setting: Setting;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  if (setting.type === "switch") {
    return (
      <div className="flex items-center justify-between">
        <Label htmlFor={setting.name}>{label}</Label>
        <Switch
          id={setting.name}
          checked={value === "true"}
          onCheckedChange={(checked) => onChange(checked ? "true" : "false")}
        />
      </div>
    );
  }

  if (setting.type === "select" && setting.options) {
    return (
      <div className="space-y-2">
        <Label htmlFor={setting.name}>{label}</Label>
        <Select value={value} onValueChange={(v) => onChange(v || "")}>
          <SelectTrigger>
            <SelectValue placeholder={setting.placeholder || "Select..."} />
          </SelectTrigger>
          <SelectContent>
            {setting.options.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  if (setting.type === "textarea") {
    return (
      <div className="space-y-2">
        <Label htmlFor={setting.name}>{label}</Label>
        <textarea
          id={setting.name}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={setting.placeholder}
          rows={3}
          className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={setting.name}>{label}</Label>
      <Input
        id={setting.name}
        type={setting.type === "password" ? "password" : setting.type === "number" ? "number" : "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={setting.placeholder}
      />
    </div>
  );
}
