"""Chat channels module with plugin architecture."""

from aimtutor.tutorbot.channels.base import BaseChannel
from aimtutor.tutorbot.channels.manager import ChannelManager

__all__ = ["BaseChannel", "ChannelManager"]
