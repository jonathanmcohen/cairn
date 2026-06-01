import type { Route } from 'next';
import { notFound, redirect } from 'next/navigation';
import { AirtableConfigForm } from '@/components/connectors/airtable-config-form';
import { CsvConfigForm } from '@/components/connectors/csv-config-form';
import { SheetsConfigForm } from '@/components/connectors/sheets-config-form';
import { SettingsBreadcrumb } from '@/components/settings/breadcrumb';
import { getDb } from '@/db/client';
import { getAuthContext, hasMinRole } from '@/lib/auth/require-role';
import { getConnectorForConfig } from '@/lib/connectors/manage';
import { ConnectorConfigHeader } from './config-header';

export const dynamic = 'force-dynamic';

export default async function ConnectorConfigPage({
  params,
}: {
  params: Promise<{ connectorId: string }>;
}) {
  const { connectorId } = await params;
  const ctx = await getAuthContext();
  if (!ctx?.workspaceId || !ctx.role) redirect('/login');
  if (!hasMinRole(ctx.role, 'admin')) redirect('/settings/developer/connectors');

  const view = await getConnectorForConfig(getDb(), connectorId, ctx.workspaceId);
  if (!view) notFound();

  const { connector, properties } = view;
  const sync = connector.syncConfig as Record<string, unknown>;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <SettingsBreadcrumb
        section={{ label: 'Developer', href: '/settings/developer' as Route }}
        page="Connectors"
      />
      <ConnectorConfigHeader kind={connector.kind} />

      {connector.kind === 'google_sheets' ? (
        <SheetsConfigForm
          connectorId={connector.id}
          properties={properties}
          initial={{
            spreadsheetId: sync.spreadsheetId as string | undefined,
            sheetTitle: sync.sheetTitle as string | undefined,
            headerRow: sync.headerRow as number | undefined,
            columnMap: sync.columnMap as Record<string, string> | undefined,
            externalIdProperty: sync.externalIdProperty as string | undefined,
          }}
        />
      ) : connector.kind === 'airtable' ? (
        <AirtableConfigForm
          connectorId={connector.id}
          properties={properties}
          initial={{
            baseId: sync.baseId as string | undefined,
            tableId: sync.tableId as string | undefined,
            fieldMap: sync.fieldMap as Record<string, string> | undefined,
            externalIdProperty: sync.externalIdProperty as string | undefined,
            patPresent: connector.enabled,
          }}
        />
      ) : (
        <CsvConfigForm
          connectorId={connector.id}
          properties={properties}
          initial={{
            relativePath: sync.relativePath as string | undefined,
            delimiter: sync.delimiter as string | undefined,
            encoding: sync.encoding as string | undefined,
            columnMap: sync.columnMap as Record<string, string> | undefined,
            externalIdProperty: sync.externalIdProperty as string | undefined,
          }}
        />
      )}
    </div>
  );
}
