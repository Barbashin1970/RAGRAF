import uuid
from sqlalchemy import BigInteger, Float, Integer, String, Text, UniqueConstraint, DateTime, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class ModelBase(DeclarativeBase):
    pass

# ---------------------------------------------------------------------------
# Person detection events
# ---------------------------------------------------------------------------

class EventPerson(ModelBase):
    """
    ORM-модель таблицы person.
    Одна запись = одно событие детекции человека с камеры.
    """

    __tablename__ = "person"

    index: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    event_type: Mapped[str] = mapped_column(Text, nullable=False)
    camera_id: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    camera_name: Mapped[str | None] = mapped_column(Text, nullable=True, index=True)
    timestamp: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)

    image_path: Mapped[str] = mapped_column(Text, nullable=False)
    image_base64: Mapped[str] = mapped_column(Text, nullable=False)
    box_image_path: Mapped[str] = mapped_column(Text, nullable=False)

    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    class_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    track_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    bbox: Mapped[str | None] = mapped_column(Text, nullable=True)

    glasses: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    male: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    female: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

    age_0_9: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    age_10_16: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    age_17_35: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    age_36_50: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    age_50_plus: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

    hat_cap: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    hat_hat: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    hat_baseball: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    hat_hood: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    hat_scarf: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    hat_dark: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    hat_light: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

    headphones: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

    top_yellow: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    top_green: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    top_blue: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    top_lightblue: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    top_red: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    top_pink: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    top_white: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    top_black: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    top_gray: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    top_brown: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    top_orange: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    top_purple: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

    bottom_yellow: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    bottom_green: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    bottom_blue: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    bottom_lightblue: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    bottom_red: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    bottom_pink: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    bottom_white: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    bottom_black: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    bottom_gray: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    bottom_brown: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    bottom_orange: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    bottom_purple: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

    top_jacket: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    top_coat: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    top_vest: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    top_hoodie: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    top_tshirt: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    top_shirt: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    top_dress: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    top_blazer: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

    sleeve_long: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    sleeve_short: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

    bottom_trousers: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    bottom_skirt: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    bottom_shorts: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

    shoes_dark: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    shoes_light: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

    bag_backpack: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    bag_shoulder: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    bag_hand: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

    view_front: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    view_back: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    view_side: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

    tattoo: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    full_visible: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

    haircut_bald: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    haircut_short: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    haircut_medium: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    haircut_long: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

    ectomorph: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    mesomorph: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    endomorph: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
