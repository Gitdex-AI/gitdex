"use client";

import { Code, Menu, Text } from "@mantine/core";
import { Info, MoreHorizontal, RefreshCw, Settings2 } from "lucide-react";
import { SelfUpdateDialog } from "@/components/SelfUpdateDialog";

export function HeaderSecondaryActions({
  codexModel,
  webhookUrl,
  version
}: {
  codexModel: string;
  webhookUrl: string;
  version: string;
}) {
  return (
    <Menu shadow="md" width={340} position="bottom-end" withArrow>
      <Menu.Target>
        <button className="topbar-menu-trigger" type="button" aria-label="Open console details and actions">
          <MoreHorizontal size={18} aria-hidden="true" />
          <span>Console</span>
        </button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>Runtime</Menu.Label>
        <Menu.Item leftSection={<Settings2 size={16} aria-hidden="true" />} closeMenuOnClick={false}>
          <span className="topbar-menu-item">
            <Text component="span" size="sm" fw={700}>Model</Text>
            <Code>{codexModel}</Code>
          </span>
        </Menu.Item>
        <Menu.Item leftSection={<Info size={16} aria-hidden="true" />} closeMenuOnClick={false}>
          <span className="topbar-menu-item">
            <Text component="span" size="sm" fw={700}>Webhook</Text>
            <Code>{webhookUrl}</Code>
          </span>
        </Menu.Item>
        <Menu.Divider />
        <div className="topbar-menu-action-row">
          <RefreshCw size={16} aria-hidden="true" />
          <SelfUpdateDialog version={version} triggerClassName="topbar-menu-action" triggerLabel={`Self-update v${version}`} />
        </div>
      </Menu.Dropdown>
    </Menu>
  );
}
