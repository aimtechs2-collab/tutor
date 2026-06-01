"""Upload processing pipelines."""

from aimtutor.services.uploads.pipelines.archive import ArchivePipeline
from aimtutor.services.uploads.pipelines.document import DocumentPipeline
from aimtutor.services.uploads.pipelines.image import ImagePipeline
from aimtutor.services.uploads.pipelines.media import MediaPipeline

__all__ = [
    "ArchivePipeline",
    "DocumentPipeline",
    "ImagePipeline",
    "MediaPipeline",
]
