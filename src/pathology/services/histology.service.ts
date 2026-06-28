import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HistologySlide } from '../entities/histology-slide.entity';
import { CreateHistologySlideDto } from '../dto/create-histology-slide.dto';
import { findOneOrFail } from '../../common/utils/entity-lookup.util';

@Injectable()
export class HistologyService {
  private readonly logger = new Logger(HistologyService.name);

  constructor(
    @InjectRepository(HistologySlide)
    private slideRepository: Repository<HistologySlide>,
  ) {}

  async create(createDto: CreateHistologySlideDto, userId: string): Promise<HistologySlide> {
    const slideNumber = await this.generateSlideNumber(createDto.pathologyCaseId);

    const slide = this.slideRepository.create({
      ...createDto,
      slideNumber,
      stainDate: new Date(),
      createdBy: userId,
      updatedBy: userId,
    });

    const saved = await this.slideRepository.save(slide);
    this.logger.log(`Histology slide created: ${saved.id} (${saved.slideNumber})`);

    return saved;
  }

  async findOne(id: string): Promise<HistologySlide> {
    return findOneOrFail(this.slideRepository, 'Histology slide', {
      where: { id },
      relations: ['pathologyCase', 'digitalImages'],
    });
  }

  async findByCase(caseId: string): Promise<HistologySlide[]> {
    return this.slideRepository.find({
      where: { pathologyCaseId: caseId },
      relations: ['digitalImages'],
      order: { slideNumber: 'ASC' },
    });
  }

  async performStaining(
    id: string,
    stainType: string,
    technicianId: string,
    technicianName: string,
    userId: string,
  ): Promise<HistologySlide> {
    const slide = await this.findOne(id);

    slide.stainType = stainType as any;
    slide.technicianId = technicianId;
    slide.technicianName = technicianName;
    slide.stainDate = new Date();
    slide.updatedBy = userId;

    return this.slideRepository.save(slide);
  }

  async requestRecut(id: string, reason: string, userId: string): Promise<HistologySlide> {
    const slide = await this.findOne(id);

    slide.recutRequired = true;
    slide.recutReason = reason;
    slide.updatedBy = userId;

    return this.slideRepository.save(slide);
  }

  private async generateSlideNumber(caseId: string): Promise<string> {
    const count = await this.slideRepository.count({
      where: { pathologyCaseId: caseId },
    });

    return `SLIDE-H-${count + 1}`;
  }
}
