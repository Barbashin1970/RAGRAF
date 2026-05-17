import uuid
from sqlalchemy import BigInteger, Float, Integer, String, Text, UniqueConstraint, DateTime, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class ModelBase(DeclarativeBase):
    pass

# ---------------------------------------------------------------------------
# GRZ detection events
# ---------------------------------------------------------------------------

class EventNumberPlate(ModelBase):
    __tablename__ = "anpr"

    index: Mapped[uuid.UUID] = mapped_column(
        UUID, primary_key=True, default=uuid.uuid4)

    event_type: Mapped[str] = mapped_column(Text, nullable=False)
    camera_id: Mapped[str] = mapped_column(Text, nullable=False)
    camera_name: Mapped[str] = mapped_column(Text, nullable=True)
    timestamp: Mapped[int] = mapped_column(BigInteger, nullable=False)
    image_path: Mapped[str] = mapped_column(Text, nullable=False)
    box_image_path: Mapped[str] = mapped_column(Text, nullable=False)

    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    class_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    track_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    
    bbox: Mapped[str | None] = mapped_column(Text, nullable=True) 
    
    numberPlate: Mapped[str | None] = mapped_column(Text, nullable=True)
    vehicleTypeId: Mapped[int] = mapped_column(Float, nullable=False, default=0)
    color: Mapped[str| None] = mapped_column(Text, nullable=True)
    brand: Mapped[str| None] = mapped_column(Text, nullable=True)
    model: Mapped[str| None] = mapped_column(Text, nullable=True)
    direction: Mapped[int| None] = mapped_column(Integer, nullable=True)
