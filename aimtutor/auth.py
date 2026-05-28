"""Compatibility auth shim.

New code should import router dependencies from ``aimtutor.api.routers.auth``.
This module exists for integrations that expect ``aimtutor.auth`` while Clerk
is being introduced.
"""

from __future__ import annotations

from aimtutor.auth_clerk import clerk_is_enabled

if clerk_is_enabled():
    from aimtutor.auth_clerk import (  # noqa: F401
        get_current_user_clerk as get_optional_current_user,
        require_admin as require_admin_user,
        require_clerk_user as get_current_user,
    )
else:
    from aimtutor.api.routers.auth import (  # noqa: F401
        require_admin as require_admin_user,
        require_auth as get_current_user,
        require_auth as get_optional_current_user,
    )
