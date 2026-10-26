"""Bounded YOLO11 ONNX inference; no PyTorch checkpoint is executed by the worker."""
import io,time
import numpy as np
from PIL import Image
from image_rgb import rgb_on_white

def nms(boxes,scores,classes,threshold,max_det=300):
    order=scores.argsort()[::-1];keep=[]
    while order.size and len(keep)<max_det:
        i=int(order[0]);keep.append(i);rest=order[1:]
        if not rest.size:break
        x1=np.maximum(boxes[i,0],boxes[rest,0]);y1=np.maximum(boxes[i,1],boxes[rest,1])
        x2=np.minimum(boxes[i,2],boxes[rest,2]);y2=np.minimum(boxes[i,3],boxes[rest,3])
        inter=np.maximum(0,x2-x1)*np.maximum(0,y2-y1)
        area=(boxes[:,2]-boxes[:,0])*(boxes[:,3]-boxes[:,1])
        iou=inter/np.maximum(area[i]+area[rest]-inter,1e-9)
        order=rest[(classes[rest]!=classes[i])|(iou<=threshold)]
    return keep

class Detector:
    def __init__(self,path,categories):
        import onnxruntime as ort
        opts=ort.SessionOptions();opts.intra_op_num_threads=4;opts.inter_op_num_threads=1
        self.session=ort.InferenceSession(str(path),sess_options=opts,providers=['CPUExecutionProvider'])
        inputs=self.session.get_inputs()
        if len(inputs)!=1 or inputs[0].type!='tensor(float)':raise ValueError('Unsupported model input')
        shape=inputs[0].shape
        if len(shape)!=4 or shape[:2]!=[1,3] or not all(isinstance(v,int) and 32<=v<=1536 for v in shape[2:]):raise ValueError('Expected fixed batch=1 NCHW ONNX')
        self.h,self.w=shape[2:];self.input=inputs[0].name;self.categories=categories
        if [c['id'] for c in categories]!=list(range(len(categories))):raise ValueError('Invalid category order')
    def predict(self,data,confidence=0.25,iou=0.45):
        started=time.monotonic()
        with Image.open(io.BytesIO(data)) as image:
            width,height=image.size
            if width*height>20_000_000:raise ValueError('Image exceeds 20 megapixels')
            image=rgb_on_white(image);scale=min(self.w/width,self.h/height)
            nw,nh=round(width*scale),round(height*scale)
            left,top=round((self.w-nw)/2-0.1),round((self.h-nh)/2-0.1)
            canvas=Image.new('RGB',(self.w,self.h),(114,114,114))
            canvas.paste(image.resize((nw,nh),Image.Resampling.BILINEAR),(left,top))
            tensor=np.asarray(canvas,dtype=np.float32).transpose(2,0,1)[None]/255.0
        outputs=self.session.run(None,{self.input:np.ascontiguousarray(tensor)})
        raw=outputs[0]
        if raw.ndim!=3 or raw.shape[0]!=1 or raw.shape[1]!=4+len(self.categories):raise ValueError('Unsupported output: expected YOLO11 raw detections')
        pred=raw[0].T
        if not np.isfinite(pred).all():raise ValueError('Model returned non-finite predictions')
        classes=pred[:,4:].argmax(axis=1);scores=pred[np.arange(len(pred)),4+classes]
        mask=scores>=confidence;pred,classes,scores=pred[mask],classes[mask],scores[mask]
        if not len(pred):return [],(time.monotonic()-started)*1000
        # Bound NMS cost on pathological models, without changing the class-wise overlap rule.
        order=scores.argsort()[::-1][:10000];pred,classes,scores=pred[order],classes[order],scores[order]
        boxes=np.column_stack((pred[:,0]-pred[:,2]/2,pred[:,1]-pred[:,3]/2,pred[:,0]+pred[:,2]/2,pred[:,1]+pred[:,3]/2))
        keep=nms(boxes,scores,classes,iou);result=[]
        for k in keep:
            x1=max(0,min(width,round((float(boxes[k,0])-left)/scale)));y1=max(0,min(height,round((float(boxes[k,1])-top)/scale)))
            x2=max(0,min(width,round((float(boxes[k,2])-left)/scale)));y2=max(0,min(height,round((float(boxes[k,3])-top)/scale)))
            if x2>x1 and y2>y1:result.append({'classId':int(classes[k]),'score':max(0,min(1,float(scores[k]))),'x':x1,'y':y1,'width':x2-x1,'height':y2-y1})
        return result,(time.monotonic()-started)*1000
