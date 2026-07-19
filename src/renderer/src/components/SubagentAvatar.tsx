import avatar101 from "@/assets/subagent-avatars/avatar_1_01.png";
import avatar102 from "@/assets/subagent-avatars/avatar_1_02.png";
import avatar103 from "@/assets/subagent-avatars/avatar_1_03.png";
import avatar104 from "@/assets/subagent-avatars/avatar_1_04.png";
import avatar105 from "@/assets/subagent-avatars/avatar_1_05.png";
import avatar201 from "@/assets/subagent-avatars/avatar_2_01.png";
import avatar202 from "@/assets/subagent-avatars/avatar_2_02.png";
import avatar203 from "@/assets/subagent-avatars/avatar_2_03.png";
import avatar204 from "@/assets/subagent-avatars/avatar_2_04.png";
import avatar205 from "@/assets/subagent-avatars/avatar_2_05.png";
import avatar301 from "@/assets/subagent-avatars/avatar_3_01.png";
import avatar302 from "@/assets/subagent-avatars/avatar_3_02.png";
import avatar303 from "@/assets/subagent-avatars/avatar_3_03.png";
import avatar304 from "@/assets/subagent-avatars/avatar_3_04.png";
import avatar305 from "@/assets/subagent-avatars/avatar_3_05.png";
import avatar401 from "@/assets/subagent-avatars/avatar_4_01.png";
import avatar402 from "@/assets/subagent-avatars/avatar_4_02.png";
import avatar403 from "@/assets/subagent-avatars/avatar_4_03.png";
import avatar404 from "@/assets/subagent-avatars/avatar_4_04.png";
import avatar405 from "@/assets/subagent-avatars/avatar_4_05.png";
import avatar501 from "@/assets/subagent-avatars/avatar_5_01.png";
import avatar502 from "@/assets/subagent-avatars/avatar_5_02.png";
import avatar503 from "@/assets/subagent-avatars/avatar_5_03.png";
import avatar504 from "@/assets/subagent-avatars/avatar_5_04.png";
import avatar505 from "@/assets/subagent-avatars/avatar_5_05.png";
import { cn } from "@/lib/utils";
import {
  subagentAvatarId,
  type SubagentAvatarId,
} from "@/lib/subagent-avatar";

const AVATAR_URLS: Record<SubagentAvatarId, string> = {
  "1_01": avatar101,
  "1_02": avatar102,
  "1_03": avatar103,
  "1_04": avatar104,
  "1_05": avatar105,
  "2_01": avatar201,
  "2_02": avatar202,
  "2_03": avatar203,
  "2_04": avatar204,
  "2_05": avatar205,
  "3_01": avatar301,
  "3_02": avatar302,
  "3_03": avatar303,
  "3_04": avatar304,
  "3_05": avatar305,
  "4_01": avatar401,
  "4_02": avatar402,
  "4_03": avatar403,
  "4_04": avatar404,
  "4_05": avatar405,
  "5_01": avatar501,
  "5_02": avatar502,
  "5_03": avatar503,
  "5_04": avatar504,
  "5_05": avatar505,
};

export function SubagentAvatar({
  avatarId,
  className,
}: {
  avatarId?: SubagentAvatarId;
  className?: string;
}) {
  const resolvedId = avatarId ?? subagentAvatarId("native-subagent");
  return (
    <span
      data-subagent-avatar={resolvedId}
      className={cn(
        "inline-flex size-[18px] shrink-0 overflow-hidden rounded-[5px]",
        "bg-bg-surface ring-1 ring-black/5 dark:ring-white/10",
        className,
      )}
    >
      <img
        src={AVATAR_URLS[resolvedId]}
        alt=""
        aria-hidden="true"
        className="size-full object-cover"
        draggable={false}
      />
    </span>
  );
}
