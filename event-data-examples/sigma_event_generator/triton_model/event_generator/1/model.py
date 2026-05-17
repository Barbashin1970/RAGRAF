# triton_model/1/model.py
import json
import random
import numpy as np
from datetime import datetime, timezone
import triton_python_backend_utils as pb_utils

class TritonPythonModel:
    """
    Triton Python Backend: генерация события по схеме
    """
    
    def initialize(self, args):
        self.logger = pb_utils.Logger
        self.event_types = [
            {"desc_template": "Копка на координатах ({x} м от 0 до 10 км)", "event_code": "digging"},
            {"desc_template": "Шаг человека на координатах ({x} м от 0 до 10 км)", "event_code": "human_step"},
            {"desc_template": "Шумовое событие на координатах ({x} м от 0 до 10 км)", "event_code": "noise_event"}
        ]
        self.logger.log_info("Event generator model initialized")
    
    def _generate_event_payload(self):
        """Генерация события согласно схеме"""
        x_coord = random.randint(0, 10000)  # 0-10 км в метрах
        event_type = random.choice(self.event_types)
        timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        
        payload = {
            "event": event_type["event_code"],
            "x": x_coord,
            "confidence": round(random.uniform(0.70, 0.99), 2)
        }
        
        description = event_type["desc_template"].format(x=x_coord)
        
        event_object = {
            "description": description,
            "timestamp": timestamp,
            "payload": payload
        }
        
        # Обёртка в "msg" как в примере curl
        return {"msg": event_object}, timestamp
    
    def execute(self, requests):
        responses = []
        
        for request in requests:
            # Генерация события
            wrapped_event, timestamp = self._generate_event_payload()
            
            # Подготовка выходного тензора
            output_str = json.dumps({
                "status": "generated",
                "timestamp": timestamp,
                "event": wrapped_event
            }, ensure_ascii=False)
            
            output_tensor = pb_utils.Tensor(
                "output",
                np.array([output_str], dtype=object)
            )
            
            inference_response = pb_utils.InferenceResponse(
                output_tensors=[output_tensor]
            )
            responses.append(inference_response)
        
        return responses
