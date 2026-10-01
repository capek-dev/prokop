import type { ProkopaiClient } from '@prokopai/sdk';
import { ToolsPanel } from '../tools/ToolsPanel';
import { EnvPanel } from './EnvPanel';

interface ToolsEnvironmentPanelProps {
  sdkClient: ProkopaiClient | null;
}

/** Prokop-runtime tool surfaces merged into one tab: catalog plus environment variables. */
export function ToolsEnvironmentPanel({ sdkClient }: ToolsEnvironmentPanelProps) {
  return (
    <div className="p-3 sm:p-4 space-y-6">
      <section aria-labelledby="tools-catalog-heading" className="space-y-3">
        <h3 id="tools-catalog-heading" className="text-sm font-semibold">
          Tools
        </h3>
        <ToolsPanel sdkClient={sdkClient} embedded />
      </section>

      <section aria-labelledby="tools-environment-heading" className="space-y-3 border-t pt-5">
        <h3 id="tools-environment-heading" className="text-sm font-semibold">
          Environment
        </h3>
        <EnvPanel sdkClient={sdkClient} embedded />
      </section>
    </div>
  );
}
