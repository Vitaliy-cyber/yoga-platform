"""Common schemas used across the API.

This module contains reusable schema components for consistent API responses.
"""

from datetime import datetime
from typing import Generic, List, Optional, TypeVar

from pydantic import BaseModel, Field


# Generic type for paginated item lists
T = TypeVar("T")


class PaginatedResponse(BaseModel, Generic[T]):
    """
    Standard pagination response wrapper.

    All paginated list endpoints should use this format for consistency.

    Attributes:
        items: List of items for the current page
        total: Total count of all items matching the query
        skip: Number of items skipped (offset)
        limit: Maximum items per page (page size)
    """
    items: List[T]
    total: int = Field(..., ge=0, description="Total number of items matching the query")
    skip: int = Field(..., ge=0, description="Number of items skipped")
    limit: int = Field(..., ge=1, description="Maximum items per page")

    model_config = {"from_attributes": True}


class ErrorResponse(BaseModel):
    """
    Standard error response format.

    All API errors should use this format for consistency.

    Attributes:
        detail: Human-readable error message
        code: Optional machine-readable error code for programmatic handling
    """
    detail: str = Field(..., description="Human-readable error description")
    code: Optional[str] = Field(
        None,
        description="Machine-readable error code for programmatic error handling"
    )

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "detail": "Resource not found",
                    "code": "NOT_FOUND"
                },
                {
                    "detail": "Invalid input data",
                    "code": "VALIDATION_ERROR"
                }
            ]
        }
    }


class HealthResponse(BaseModel):
    """Health check response."""
    status: str = "ok"
    version: str = "1.0.0"
    timestamp: datetime = Field(default_factory=datetime.utcnow)
