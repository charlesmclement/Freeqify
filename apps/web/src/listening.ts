import { listeningThreshold } from '@freeqify/shared';
/** Counts forward playback bounded by elapsed wall time; seeks and paused samples do not count. */
export class ListeningAttempt {
  readonly eventId = crypto.randomUUID();
  listened = 0;
  private previous: {position:number; time:number} | null = null;
  private lastSent = -1;
  sample(position:number,time:number,playing:boolean) {
    if (playing && this.previous) {
      const wall=Math.max(0,(time-this.previous.time)/1000); const delta=position-this.previous.position;
      if (delta>0 && delta<=wall*1.5+0.25) this.listened+=Math.min(delta,wall,2);
    }
    this.previous=playing?{position,time}:null;
  }
  shouldSend(duration:number|null) {return this.listened>=listeningThreshold(duration) && (this.lastSent<0 || this.listened-this.lastSent>=15);}
  sent() {this.lastSent=this.listened;}
}
