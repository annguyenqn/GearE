import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ProductEntity } from './entities/product.entity';
import { CreateProductDto } from './dtos/createProduct.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ProductPageOptionsDto } from './dtos/ProductPageOptionsDto';
import { PaginationDto } from '@src/common/dto/paginate.dto';
import { CategoryEntity } from './entities/category.entity';
import { CloudinaryService } from 'src/modules/cloudinary/cloudinary.service';
import { ProductImageEntity } from './entities/productImage.entity';

@Injectable()
export class ProductService {
  constructor(
    @InjectRepository(ProductEntity)
    private productRepository: Repository<ProductEntity>,
    @InjectRepository(CategoryEntity)
    private categoryRepository: Repository<CategoryEntity>,
    private readonly cloudinaryService: CloudinaryService,
  ) {}
  async getProducts(
    pageOptionsDto: ProductPageOptionsDto,
  ): Promise<PaginationDto<ProductEntity>> {
    const { page, order, take, skip } = pageOptionsDto;
    const [products, total] = await this.productRepository.findAndCount({
      take,
      skip,
      order: {
        id: order,
      },
      relations: ['images'],
    });

    return {
      hasPreviousPage: page > 1,
      itemCount: products.length,
      pageCount: Math.ceil(total / take),
      values: products,
      hasNextPage: products.length === take,
      take,
      page,
    };
  }

  async createProducts(
    createProduct: CreateProductDto,
    files: Express.Multer.File[],
  ): Promise<ProductEntity> {
    const { categories: categoryIds, ...productData } = createProduct;

    const existingProduct = await this.productRepository.findOne({
      where: [
        { product_code: createProduct.product_code },
        { name: createProduct.name },
      ],
    });

    if (existingProduct) {
      throw new ConflictException('Product code or name already exists');
    }

    const categories = await this.categoryRepository.findBy({
      id: In(categoryIds),
    });

    if (!categories.length) {
      throw new NotFoundException('One or more categories not found');
    }

    return this.productRepository.manager.transaction(
      async (transactionalEntityManager) => {
        const product = transactionalEntityManager.create(ProductEntity, {
          ...productData,
          categories,
        });

        const savedProduct = await transactionalEntityManager.save(product);

        const uploadResults = await this.cloudinaryService.uploadFiles(files);
        const uploadedImages = uploadResults.filter((result) => result.url);

        const productImages = uploadedImages.map((result) => {
          const image = new ProductImageEntity();
          image.url = result.url;
          image.product = savedProduct;
          return image;
        });

        if (productImages.length > 0) {
          await transactionalEntityManager.save(
            ProductImageEntity,
            productImages,
          );
        }
        return savedProduct;
      },
    );
  }
}
