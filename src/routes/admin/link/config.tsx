import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Save } from 'lucide-react';
import { toast } from 'sonner';

import { apiGet, apiPost } from '@/lib/api-client';
import { m } from '@/paraglide/messages.js';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

type LinkConfig = { backlink_enabled: string; backlink_code: string };

function LinkConfigPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<LinkConfig>({
    backlink_enabled: 'false',
    backlink_code: '',
  });
  const query = useQuery({
    queryKey: ['backlink-config'],
    queryFn: () => apiGet<LinkConfig>('/api/admin/link/config'),
  });
  useEffect(() => {
    if (query.data) setForm(query.data);
  }, [query.data]);
  const save = useMutation({
    mutationFn: (value: LinkConfig) => apiPost('/api/admin/link/config', value),
    onSuccess: () => {
      toast.success(m['admin.settings.save_success']());
      queryClient.invalidateQueries({ queryKey: ['backlink-config'] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  return (
    <div className="max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">{m['admin.backlink.title']()}</h1>
        <p className="text-muted-foreground">
          {m['admin.backlink.description']()}
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{m['admin.backlink.card_title']()}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="backlink-code">
              {m['admin.backlink.code_label']()}
            </Label>
            <Textarea
              id="backlink-code"
              value={form.backlink_code}
              onChange={(e) =>
                setForm({ ...form, backlink_code: e.target.value })
              }
              placeholder={'<a href="https://example.com">Example</a>'}
              rows={6}
            />
            <p className="text-muted-foreground text-sm">
              {m['admin.backlink.code_hint']()}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="backlink-enabled">
              {m['admin.backlink.enabled_label']()}
            </Label>
            <input
              id="backlink-enabled"
              type="checkbox"
              checked={form.backlink_enabled === 'true'}
              onChange={(e) =>
                setForm({
                  ...form,
                  backlink_enabled: e.target.checked ? 'true' : 'false',
                })
              }
            />
          </div>
          <Button
            onClick={() => save.mutate(form)}
            disabled={save.isPending || query.isLoading}
            className="gap-2"
          >
            <Save className="size-4" />
            {save.isPending
              ? m['admin.settings.saving']()
              : m['admin.settings.save']()}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export const Route = createFileRoute('/admin/link/config')({
  component: LinkConfigPage,
});
