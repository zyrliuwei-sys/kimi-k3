"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/core/i18n/navigation";
import { signIn } from "@/core/auth/client";
import { envConfigs } from "@/config";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export default function SignInPage() {
  const t = useTranslations("common");
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [configs, setConfigs] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch("/api/config/public")
      .then((r) => r.json())
      .then((res) => {
        if (res.code === 0) setConfigs(res.data);
      })
      .catch(() => {});
  }, []);

  const googleEnabled = configs.google_auth_enabled === "true";
  const githubEnabled = configs.github_auth_enabled === "true";
  const hasSocial = googleEnabled || githubEnabled;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = await signIn.email({ email, password });
      if (result.error) {
        setError(result.error.message || "Sign in failed");
      } else {
        router.push("/dashboard");
      }
    } catch (err: any) {
      setError(err.message || "Sign in failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleSocial(provider: "google" | "github") {
    await signIn.social({ provider, callbackURL: "/dashboard" });
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <Link href="/" className="flex items-center gap-2 self-center font-medium">
          <div className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground text-xs font-bold">
            {(envConfigs.app_name || "A").charAt(0)}
          </div>
          {envConfigs.app_name}
        </Link>
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-xl">{t("sign.sign_in_title")}</CardTitle>
            <CardDescription>{t("sign.sign_in_description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit}>
              <FieldGroup>
                {error && (
                  <div className="rounded-lg bg-destructive/10 text-destructive text-sm p-3">
                    {error}
                  </div>
                )}

                {hasSocial && (
                  <Field>
                    {googleEnabled && (
                      <Button variant="outline" type="button" onClick={() => handleSocial("google")}>
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="size-4">
                          <path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z" fill="currentColor" />
                        </svg>
                        {t("sign.google_sign_in")}
                      </Button>
                    )}
                    {githubEnabled && (
                      <Button variant="outline" type="button" onClick={() => handleSocial("github")}>
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="size-4">
                          <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" fill="currentColor" />
                        </svg>
                        {t("sign.github_sign_in")}
                      </Button>
                    )}
                  </Field>
                )}

                {hasSocial && (
                  <FieldSeparator className="*:data-[slot=field-separator-content]:bg-card">
                    {t("sign.or")}
                  </FieldSeparator>
                )}

                <Field>
                  <FieldLabel htmlFor="email">{t("sign.email_title")}</FieldLabel>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    placeholder={t("sign.email_placeholder")}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="password">{t("sign.password_title")}</FieldLabel>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    placeholder={t("sign.password_placeholder")}
                  />
                </Field>
                <Field>
                  <Button type="submit" disabled={loading}>
                    {loading ? "..." : t("sign.sign_in_title")}
                  </Button>
                  <FieldDescription className="text-center">
                    {t("sign.no_account")}{" "}
                    <Link href="/sign-up" className="underline underline-offset-4">
                      {t("sign.sign_up_title")}
                    </Link>
                  </FieldDescription>
                </Field>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
