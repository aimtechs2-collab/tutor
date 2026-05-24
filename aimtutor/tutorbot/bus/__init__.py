"""Message bus module for decoupled channel-agent communication."""

from aimtutor.tutorbot.bus.events import InboundMessage, OutboundMessage
from aimtutor.tutorbot.bus.queue import MessageBus

__all__ = ["MessageBus", "InboundMessage", "OutboundMessage"]
