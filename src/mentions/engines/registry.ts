import type { IMentionRegistry, ParticipantRegistration } from '../types/participant.js';

export class MentionRegistry implements IMentionRegistry {
  private readonly byName = new Map<string, ParticipantRegistration>();
  private readonly byId = new Map<string, ParticipantRegistration>();

  register(participant: ParticipantRegistration): void {
    if (this.byName.has(participant.name)) {
      throw new Error(`Participant @${participant.name} is already registered`);
    }
    this.byName.set(participant.name, participant);
    this.byId.set(participant.id, participant);
  }

  resolve(name: string): ParticipantRegistration | undefined {
    return this.byName.get(name);
  }

  detectParticipant(prompt: string): ParticipantRegistration | undefined {
    const lower = prompt.toLowerCase();
    let best: ParticipantRegistration | undefined;
    let bestScore = 0;

    for (const participant of this.byName.values()) {
      let score = 0;
      for (const example of participant.detectionExamples ?? []) {
        if (lower.includes(example.toLowerCase())) score += 1;
      }
      if (score > 0 && score > bestScore) {
        best = participant;
        bestScore = score;
      }
    }

    return best;
  }

  list(): ParticipantRegistration[] {
    return [...this.byName.values()];
  }
}
