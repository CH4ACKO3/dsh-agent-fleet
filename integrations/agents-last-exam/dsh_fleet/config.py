from __future__ import annotations

from dataclasses import dataclass, field
from typing import ClassVar


@dataclass
class DshFleetConfig:
    """Agent Last Exam settings for the native DSH Fleet launcher."""

    name: ClassVar[str] = "dsh-fleet"

    model: str = "deepseek-v4-pro"
    provider: str = "deepseek-official"
    provider_env_key: str = "DEEPSEEK_API_KEY"
    api_key: str | None = field(default=None, metadata={"secret": True})
    team_config: str = "/opt/dsh-fleet-ale/coding-small.json"
    dsh_home: str = "/home/user/.dsh"
    max_tokens: int = 65536
    patch_path: str | None = None
    bridge_command: str | None = None
    bridge_port: int = 3081
