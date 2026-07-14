import { BehaviorSubject } from 'rxjs';

export function nextBehaviorSubjectIfChanged<T>(subject: BehaviorSubject<T>, value: T): boolean {
    if (subject.value === value) {
        return false;
    }

    subject.next(value);
    return true;
}
