/**
 * DeepSeek Harness web glyphs for agent presets.
 *
 * Official dsh web (`IconAgentPresetOutline16`) uses the 3-node graph on the
 * preset chip for every selection. Distinct option marks come from the same
 * ic_ds_* set: `#` for code, the 4-arrow plugin for cordis/creator. Minimal
 * has no dedicated official glyph; the three bars follow the same filled
 * list-stroke language as `IconChecklistOutline14`.
 *
 * Source: deepseek-ai/deepseek-harness packages/client/ui-primitives/src/icons.
 */
import { useId, type ComponentType } from "react";

export type DshPresetIcon = ComponentType<{ className?: string }>;

export function DshPresetStandardIcon({ className }: { className?: string }) {
  const maskId = `dsh-preset-mask-${useId().replaceAll(":", "")}`;
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      className={className}
      aria-hidden="true"
      data-dsh-preset-icon="standard"
    >
      <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="16" height="16">
        <rect width="16" height="16" fill="white" />
        <circle cx="7.9995" cy="3.28319" r="1.712" fill="black" />
        <circle cx="3.51122" cy="11.3855" r="1.712" fill="black" />
        <circle cx="12.4878" cy="11.3855" r="1.712" fill="black" />
      </mask>
      <path
        mask={`url(#${maskId})`}
        d="M12.2881 11.0425C12.6002 11.3723 13.0413 11.5786 13.5312 11.5786L13.5342 11.5776C13.1476 12.3233 12.6119 12.9785 11.9639 13.5005C10.9327 14.3309 9.6199 14.8286 8.19336 14.8286C7.29864 14.8285 6.45056 14.6313 5.6875 14.2808C6.08309 14.0281 6.36707 13.6189 6.45215 13.1392C6.99022 13.3561 7.57767 13.476 8.19336 13.4761C9.30019 13.4761 10.3157 13.0915 11.1152 12.4478C11.5935 12.0626 11.9924 11.5848 12.2881 11.0425ZM4.14746 4.36475C4.25569 4.83228 4.55488 5.2247 4.95898 5.4585C4.07956 6.30639 3.53144 7.49605 3.53125 8.81396C3.53125 9.69534 3.77613 10.5202 4.20117 11.2231C3.74959 11.3817 3.38395 11.7232 3.19531 12.1597C2.5541 11.2032 2.17969 10.052 2.17969 8.81396C2.17989 7.05087 2.93868 5.4646 4.14746 4.36475ZM8.19336 2.80029C8.85717 2.80029 9.49784 2.90834 10.0967 3.10791C12.3237 3.85044 13.9725 5.86061 14.1846 8.28369C13.9832 8.20048 13.7627 8.15382 13.5312 8.15381C13.2802 8.15381 13.042 8.20907 12.8271 8.30615C12.6281 6.47264 11.3666 4.95616 9.66895 4.39014C9.2063 4.236 8.70989 4.15186 8.19336 4.15186C7.96112 4.15189 7.7329 4.16981 7.50977 4.20264C7.51947 4.12886 7.52637 4.05348 7.52637 3.97705C7.52628 3.56604 7.3811 3.18914 7.13965 2.89404C7.48183 2.83352 7.83381 2.80033 8.19336 2.80029Z"
        fill="currentColor"
      />
      <path
        d="M9.1123 3.28271C9.11205 2.66858 8.61322 2.17041 7.99902 2.17041C7.38504 2.17067 6.88697 2.66874 6.88672 3.28271C6.88672 3.89691 7.38489 4.39574 7.99902 4.396C8.61338 4.396 9.1123 3.89707 9.1123 3.28271ZM10.3115 3.28271C10.3115 4.55981 9.27612 5.59521 7.99902 5.59521C6.72214 5.59496 5.6875 4.55965 5.6875 3.28271C5.68776 2.00599 6.7223 0.971447 7.99902 0.971191C9.27596 0.971191 10.3113 2.00584 10.3115 3.28271Z"
        fill="currentColor"
      />
      <path
        d="M4.62402 11.385C4.62377 10.7709 4.12494 10.2727 3.51074 10.2727C2.89676 10.273 2.39869 10.771 2.39844 11.385C2.39844 11.9992 2.89661 12.498 3.51074 12.4983C4.1251 12.4983 4.62402 11.9994 4.62402 11.385ZM5.82324 11.385C5.82324 12.6621 4.78784 13.6975 3.51074 13.6975C2.23386 13.6973 1.19922 12.6619 1.19922 11.385C1.19947 10.1083 2.23402 9.07374 3.51074 9.07349C4.78768 9.07349 5.82299 10.1081 5.82324 11.385Z"
        fill="currentColor"
      />
      <path
        d="M13.6006 11.385C13.6003 10.7709 13.1015 10.2727 12.4873 10.2727C11.8733 10.273 11.3753 10.771 11.375 11.385C11.375 11.9992 11.8732 12.498 12.4873 12.4983C13.1017 12.4983 13.6006 11.9994 13.6006 11.385ZM14.7998 11.385C14.7998 12.6621 13.7644 13.6975 12.4873 13.6975C11.2104 13.6973 10.1758 12.6619 10.1758 11.385C10.176 10.1083 11.2106 9.07374 12.4873 9.07349C13.7642 9.07349 14.7995 10.1081 14.7998 11.385Z"
        fill="currentColor"
      />
    </svg>
  );
}

/** Official `IconCodeOutline16` — octothorpe. */
export function DshPresetCodeIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      className={className}
      aria-hidden="true"
      data-dsh-preset-icon="code"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12.3368 1.53569L11.931 4.43172H14.8086V5.79673H11.7404L11.1962 9.67859H14.2839V11.0436H11.0056L10.4994 14.6529L9.14873 14.4643L9.62731 11.0436H5.75876L5.25252 14.6529L3.90186 14.4643L4.38043 11.0436H1.69141V9.67859H4.57104L5.11417 5.79673H2.21609V4.43172H5.30581L5.73724 1.34713L7.08995 1.53569L6.68414 4.43172H10.5527L10.9841 1.34713L12.3368 1.53569ZM5.94937 9.67859H9.81791L10.361 5.79673H6.49353L5.94937 9.67859Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function DshPresetMinimalIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      className={className}
      aria-hidden="true"
      data-dsh-preset-icon="minimal"
    >
      <path d="M2.4 3.55h11.2v1.45H2.4z" fill="currentColor" />
      <path d="M2.4 7.275h11.2v1.45H2.4z" fill="currentColor" />
      <path d="M2.4 11h11.2v1.45H2.4z" fill="currentColor" />
    </svg>
  );
}

/** Official `IconCordisPluginOutline14` — also Creator on the marketing site. */
export function DshPresetCordisIcon({ className }: { className?: string }) {
  const clipId = `dsh-cordis-clip-${useId().replaceAll(":", "")}`;
  return (
    <svg
      viewBox="0 0 14 14"
      fill="none"
      className={className}
      aria-hidden="true"
      data-dsh-preset-icon="cordis"
    >
      <g clipPath={`url(#${clipId})`}>
        <path
          d="M3.03426 5.66661L1.70084 7.00003L3.0315 8.33069L2.14762 9.21457L-0.0669245 7.00003L2.15038 4.78273L3.03426 5.66661ZM7 14.067L4.77924 11.8462L5.66313 10.9623L7 12.2992L8.33342 10.9658L9.2173 11.8496L7 14.067ZM11.8489 9.21803L10.965 8.33414L12.2992 7.00003L10.9623 5.66316L11.8462 4.77927L14.0669 7.00003L11.8489 9.21803ZM8.33066 3.03153L7 1.70087L5.66589 3.03498L4.782 2.1511L7 -0.0668945L9.21454 2.14765L8.33066 3.03153Z"
          fill="currentColor"
        />
        <rect x="5.98535" y="5.98535" width="2.02942" height="2.02942" fill="currentColor" />
      </g>
      <defs>
        <clipPath id={clipId}>
          <rect width="14" height="14" fill="currentColor" />
        </clipPath>
      </defs>
    </svg>
  );
}

export function agentPresetIcon(value: string): DshPresetIcon {
  switch (value.trim().toLowerCase()) {
    case "code":
      return DshPresetCodeIcon;
    case "minimal":
      return DshPresetMinimalIcon;
    case "cordis":
    case "creator":
      return DshPresetCordisIcon;
    default:
      return DshPresetStandardIcon;
  }
}
