from dataclasses import dataclass
from datetime import datetime
from typing import Dict, Any, Optional
import json

@dataclass
class Event:
    event_type: int
    camera_id: int
    timestamp: datetime
    object_info: Dict[str, Any]
    image_url: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            'event_type': self.event_type,
            'camera_id': self.camera_id,
            'timestamp': self.timestamp.isoformat(),
            'object_info': json.dumps(self.object_info),
            'image_url': self.image_url
        }
