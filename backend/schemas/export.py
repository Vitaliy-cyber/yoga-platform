"""
Export/Import schemas for yoga-platform.
Defines data structures for exporting and importing poses, categories, and full backups.
"""

from datetime import datetime
from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, Field


class ExportFormat(str, Enum):
    """Supported export formats."""
    JSON = "json"
    CSV = "csv"
    PDF = "pdf"


class DuplicateHandling(str, Enum):
    """How to handle duplicate entries during import."""
    SKIP = "skip"       # Skip duplicates, keep existing
    OVERWRITE = "overwrite"  # Overwrite existing with imported
    RENAME = "rename"   # Rename imported (add suffix)


# === Export Schemas ===

class MuscleExport(BaseModel):
    """Muscle data for export."""
    name: str = Field(..., max_length=100)
    name_ua: Optional[str] = Field(None, max_length=100)
    body_part: Optional[str] = Field(None, max_length=50)
    activation_level: int = Field(..., ge=0, le=100)


class CategoryExport(BaseModel):
    """Category data for export."""
    name: str = Field(..., max_length=200)
    description: Optional[str] = Field(None, max_length=2000)


class PoseExport(BaseModel):
    """Single pose data for export."""
    code: str = Field(..., max_length=20)
    name: str = Field(..., max_length=200)
    name_en: Optional[str] = Field(None, max_length=200)
    category_name: Optional[str] = Field(None, max_length=200)
    description: Optional[str] = Field(None, max_length=10000)
    effect: Optional[str] = Field(None, max_length=10000)
    breathing: Optional[str] = Field(None, max_length=10000)
    muscles: List[MuscleExport] = []
    # Image paths (for reference, not included in JSON export by default)
    schema_path: Optional[str] = Field(None, max_length=500)
    photo_path: Optional[str] = Field(None, max_length=500)
    muscle_layer_path: Optional[str] = Field(None, max_length=500)
    skeleton_layer_path: Optional[str] = Field(None, max_length=500)
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class BackupMetadata(BaseModel):
    """Metadata for backup files."""
    version: str = "1.0.0"
    exported_at: datetime
    user_id: Optional[int] = None
    total_poses: int
    total_categories: int


class BackupData(BaseModel):
    """Full backup data structure."""
    metadata: BackupMetadata
    categories: List[CategoryExport] = []
    poses: List[PoseExport] = []


# === Import Schemas ===

class ImportOptions(BaseModel):
    """Options for import operations."""
    duplicate_handling: DuplicateHandling = DuplicateHandling.SKIP
    import_categories: bool = True
    import_poses: bool = True


class ImportItemResult(BaseModel):
    """Result of importing a single item."""
    code: Optional[str] = None  # For poses
    name: str
    status: str  # 'created', 'updated', 'skipped', 'error'
    message: Optional[str] = None


class ImportResult(BaseModel):
    """Result of an import operation."""
    success: bool
    total_items: int
    created: int
    updated: int
    skipped: int
    errors: int
    items: List[ImportItemResult] = []
    error_message: Optional[str] = None


class ImportPreviewItem(BaseModel):
    """Preview of a single item to be imported."""
    code: Optional[str] = None
    name: str
    type: str  # 'pose' or 'category'
    exists: bool  # Whether item already exists
    will_be: str  # 'created', 'updated', 'skipped'


class ImportPreviewResult(BaseModel):
    """Preview of import operation before execution."""
    valid: bool
    total_items: int
    poses_count: int
    categories_count: int
    will_create: int
    will_update: int
    will_skip: int
    items: List[ImportPreviewItem] = []
    validation_errors: List[str] = []


# === CSV-specific schemas ===

class PoseCSVRow(BaseModel):
    """A single row in CSV export/import."""
    code: str = Field(..., max_length=20)
    name: str = Field(..., max_length=200)
    name_en: Optional[str] = Field(None, max_length=200)
    category_name: Optional[str] = Field(None, max_length=200)
    description: Optional[str] = Field(None, max_length=10000)
    effect: Optional[str] = Field(None, max_length=10000)
    breathing: Optional[str] = Field(None, max_length=10000)
    # Muscles as comma-separated string with format: "muscle1:activation,muscle2:activation"
    muscles: Optional[str] = Field(None, max_length=10000)


# === PDF Export schemas ===

class PDFExportOptions(BaseModel):
    """Options for PDF export."""
    include_photo: bool = True
    include_schema: bool = True
    include_muscle_layer: bool = True
    include_muscles_list: bool = True
    include_description: bool = True
    page_size: str = "A4"  # A4, Letter
