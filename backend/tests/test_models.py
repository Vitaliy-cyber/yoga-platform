"""
Unit tests for database models
"""

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.exc import IntegrityError

from models.category import Category
from models.muscle import Muscle
from models.pose import Pose, PoseMuscle
from db.database import Base


# Test database setup
TEST_DATABASE_URL = "sqlite:///./test_models.db"
engine = create_engine(TEST_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture(scope="function")
def db_session():
    Base.metadata.create_all(bind=engine)
    session = TestingSessionLocal()
    yield session
    session.close()
    Base.metadata.drop_all(bind=engine)


class TestCategoryModel:
    """Tests for Category model"""

    def test_create_category(self, db_session):
        category = Category(name="Test Category")
        db_session.add(category)
        db_session.commit()

        assert category.id is not None
        assert category.name == "Test Category"

    def test_category_with_description(self, db_session):
        category = Category(
            name="Стоячі пози", description="Пози, що виконуються стоячи"
        )
        db_session.add(category)
        db_session.commit()

        assert category.description == "Пози, що виконуються стоячи"

    def test_category_without_description(self, db_session):
        category = Category(name="Тільки назва")
        db_session.add(category)
        db_session.commit()

        assert category.description is None

    def test_category_unique_name(self, db_session):
        cat1 = Category(name="Unique Name")
        db_session.add(cat1)
        db_session.commit()

        cat2 = Category(name="Unique Name")
        db_session.add(cat2)

        with pytest.raises(IntegrityError):
            db_session.commit()

    def test_category_repr(self, db_session):
        category = Category(name="Test")
        db_session.add(category)
        db_session.commit()

        repr_str = repr(category)
        assert "Test" in repr_str
        assert "Category" in repr_str

    def test_multiple_categories(self, db_session):
        categories = [Category(name=f"Category {i}") for i in range(5)]
        db_session.add_all(categories)
        db_session.commit()

        result = db_session.query(Category).all()
        assert len(result) == 5

    def test_category_update(self, db_session):
        category = Category(name="Original")
        db_session.add(category)
        db_session.commit()

        category.name = "Updated"
        db_session.commit()

        updated = db_session.query(Category).filter_by(id=category.id).first()
        assert updated.name == "Updated"

    def test_category_delete(self, db_session):
        category = Category(name="To Delete")
        db_session.add(category)
        db_session.commit()
        cat_id = category.id

        db_session.delete(category)
        db_session.commit()

        result = db_session.query(Category).filter_by(id=cat_id).first()
        assert result is None

    def test_category_has_created_at(self, db_session):
        category = Category(name="Timestamp Test")
        db_session.add(category)
        db_session.commit()

        assert category.created_at is not None


class TestMuscleModel:
    """Tests for Muscle model"""

    def test_create_muscle(self, db_session):
        muscle = Muscle(name="Quadriceps", name_ua="Квадрицепс", body_part="legs")
        db_session.add(muscle)
        db_session.commit()

        assert muscle.id is not None
        assert muscle.name == "Quadriceps"
        assert muscle.body_part == "legs"

    def test_muscle_with_ukrainian_name(self, db_session):
        muscle = Muscle(name="Biceps", name_ua="Біцепс", body_part="arms")
        db_session.add(muscle)
        db_session.commit()

        assert muscle.name_ua == "Біцепс"

    def test_muscle_body_parts(self, db_session):
        body_parts = ["legs", "arms", "core", "back", "chest", "shoulders"]
        for i, bp in enumerate(body_parts):
            muscle = Muscle(name=f"Muscle {bp} {i}", body_part=bp)
            db_session.add(muscle)
        db_session.commit()

        for bp in body_parts:
            result = db_session.query(Muscle).filter_by(body_part=bp).first()
            assert result is not None

    def test_muscle_unique_name(self, db_session):
        m1 = Muscle(name="Unique Muscle", body_part="core")
        db_session.add(m1)
        db_session.commit()

        m2 = Muscle(name="Unique Muscle", body_part="arms")
        db_session.add(m2)

        with pytest.raises(IntegrityError):
            db_session.commit()

    def test_muscle_filter_by_body_part(self, db_session):
        muscles = [
            Muscle(name="Leg 1", body_part="legs"),
            Muscle(name="Leg 2", body_part="legs"),
            Muscle(name="Arm 1", body_part="arms"),
        ]
        db_session.add_all(muscles)
        db_session.commit()

        leg_muscles = db_session.query(Muscle).filter_by(body_part="legs").all()
        assert len(leg_muscles) == 2

    def test_muscle_without_body_part(self, db_session):
        muscle = Muscle(name="No Body Part")
        db_session.add(muscle)
        db_session.commit()

        assert muscle.body_part is None

    def test_multiple_muscles_same_body_part(self, db_session):
        muscles = [Muscle(name=f"Core Muscle {i}", body_part="core") for i in range(10)]
        db_session.add_all(muscles)
        db_session.commit()

        core_muscles = db_session.query(Muscle).filter_by(body_part="core").all()
        assert len(core_muscles) == 10

    def test_muscle_repr(self, db_session):
        muscle = Muscle(name="Test Muscle", body_part="arms")
        db_session.add(muscle)
        db_session.commit()

        repr_str = repr(muscle)
        assert "Test Muscle" in repr_str
        assert "Muscle" in repr_str


class TestPoseModel:
    """Tests for Pose model"""

    def test_create_pose(self, db_session):
        category = Category(name="Test Cat")
        db_session.add(category)
        db_session.commit()

        pose = Pose(code="TEST01", name="Test Pose", category_id=category.id)
        db_session.add(pose)
        db_session.commit()

        assert pose.id is not None
        assert pose.code == "TEST01"

    def test_pose_with_full_details(self, db_session):
        category = Category(name="Full Cat")
        db_session.add(category)
        db_session.commit()

        pose = Pose(
            code="FULL01",
            name="Повна поза",
            name_en="Full Pose",
            category_id=category.id,
            description="Опис пози",
            effect="Ефект пози",
            breathing="Техніка дихання",
        )
        db_session.add(pose)
        db_session.commit()

        assert pose.description == "Опис пози"
        assert pose.effect == "Ефект пози"
        assert pose.breathing == "Техніка дихання"

    def test_pose_unique_code(self, db_session):
        category = Category(name="Code Cat")
        db_session.add(category)
        db_session.commit()

        p1 = Pose(code="UNIQUE", name="Pose 1", category_id=category.id)
        db_session.add(p1)
        db_session.commit()

        p2 = Pose(code="UNIQUE", name="Pose 2", category_id=category.id)
        db_session.add(p2)

        with pytest.raises(IntegrityError):
            db_session.commit()

    def test_pose_category_relationship(self, db_session):
        category = Category(name="Rel Cat")
        db_session.add(category)
        db_session.commit()

        pose = Pose(code="REL01", name="Rel Pose", category_id=category.id)
        db_session.add(pose)
        db_session.commit()

        db_session.refresh(pose)
        assert pose.category is not None
        assert pose.category.name == "Rel Cat"

    def test_pose_image_paths(self, db_session):
        category = Category(name="Image Cat")
        db_session.add(category)
        db_session.commit()

        pose = Pose(
            code="IMG01",
            name="Image Pose",
            category_id=category.id,
            schema_path="/uploads/schema.png",
            photo_path="/generated/photo.png",
        )
        db_session.add(pose)
        db_session.commit()

        assert pose.schema_path == "/uploads/schema.png"
        assert pose.photo_path == "/generated/photo.png"

    def test_pose_filter_by_category(self, db_session):
        cat1 = Category(name="Cat 1")
        cat2 = Category(name="Cat 2")
        db_session.add_all([cat1, cat2])
        db_session.commit()

        poses = [
            Pose(code="C1P1", name="Cat1 Pose 1", category_id=cat1.id),
            Pose(code="C1P2", name="Cat1 Pose 2", category_id=cat1.id),
            Pose(code="C2P1", name="Cat2 Pose 1", category_id=cat2.id),
        ]
        db_session.add_all(poses)
        db_session.commit()

        cat1_poses = db_session.query(Pose).filter_by(category_id=cat1.id).all()
        assert len(cat1_poses) == 2

    def test_pose_search_by_name(self, db_session):
        category = Category(name="Search Cat")
        db_session.add(category)
        db_session.commit()

        poses = [
            Pose(
                code="TADA",
                name="Тадасана",
                name_en="Mountain Pose",
                category_id=category.id,
            ),
            Pose(
                code="VIRA",
                name="Вірабхадрасана",
                name_en="Warrior",
                category_id=category.id,
            ),
        ]
        db_session.add_all(poses)
        db_session.commit()

        result = db_session.query(Pose).filter(Pose.name.contains("Тада")).all()
        assert len(result) == 1
        assert result[0].code == "TADA"

    def test_pose_repr(self, db_session):
        category = Category(name="Repr Cat")
        db_session.add(category)
        db_session.commit()

        pose = Pose(code="REPR", name="Repr Pose", category_id=category.id)
        db_session.add(pose)
        db_session.commit()

        repr_str = repr(pose)
        assert "REPR" in repr_str or "Pose" in repr_str


class TestPoseMuscleModel:
    """Tests for PoseMuscle association model"""

    def test_create_pose_muscle_association(self, db_session):
        category = Category(name="PM Cat")
        db_session.add(category)
        db_session.commit()

        pose = Pose(code="PM01", name="PM Pose", category_id=category.id)
        muscle = Muscle(name="PM Muscle", body_part="core")
        db_session.add_all([pose, muscle])
        db_session.commit()

        pm = PoseMuscle(pose_id=pose.id, muscle_id=muscle.id, activation_level=75)
        db_session.add(pm)
        db_session.commit()

        assert pm.activation_level == 75

    def test_pose_muscle_activation_levels(self, db_session):
        category = Category(name="Act Cat")
        db_session.add(category)
        db_session.commit()

        pose = Pose(code="ACT01", name="Act Pose", category_id=category.id)
        db_session.add(pose)
        db_session.commit()

        activation_levels = [10, 25, 50, 75, 90, 100]
        for i, level in enumerate(activation_levels):
            muscle = Muscle(name=f"Act Muscle {i}", body_part="core")
            db_session.add(muscle)
            db_session.commit()

            pm = PoseMuscle(
                pose_id=pose.id, muscle_id=muscle.id, activation_level=level
            )
            db_session.add(pm)

        db_session.commit()

        associations = db_session.query(PoseMuscle).filter_by(pose_id=pose.id).all()
        assert len(associations) == 6

    def test_multiple_muscles_per_pose(self, db_session):
        category = Category(name="Multi Cat")
        db_session.add(category)
        db_session.commit()

        pose = Pose(code="MULTI", name="Multi Pose", category_id=category.id)
        db_session.add(pose)
        db_session.commit()

        muscles = [Muscle(name=f"Multi Muscle {i}", body_part="core") for i in range(5)]
        db_session.add_all(muscles)
        db_session.commit()

        for muscle in muscles:
            pm = PoseMuscle(pose_id=pose.id, muscle_id=muscle.id, activation_level=50)
            db_session.add(pm)

        db_session.commit()

        pose_muscles = db_session.query(PoseMuscle).filter_by(pose_id=pose.id).all()
        assert len(pose_muscles) == 5

    def test_muscle_used_in_multiple_poses(self, db_session):
        category = Category(name="Shared Cat")
        db_session.add(category)
        db_session.commit()

        muscle = Muscle(name="Shared Muscle", body_part="legs")
        db_session.add(muscle)
        db_session.commit()

        poses = [
            Pose(code=f"SH{i}", name=f"Shared Pose {i}", category_id=category.id)
            for i in range(3)
        ]
        db_session.add_all(poses)
        db_session.commit()

        for pose in poses:
            pm = PoseMuscle(pose_id=pose.id, muscle_id=muscle.id, activation_level=60)
            db_session.add(pm)

        db_session.commit()

        muscle_usages = (
            db_session.query(PoseMuscle).filter_by(muscle_id=muscle.id).all()
        )
        assert len(muscle_usages) == 3

    def test_pose_muscle_default_activation(self, db_session):
        category = Category(name="Default Cat")
        db_session.add(category)
        db_session.commit()

        pose = Pose(code="DEF01", name="Default Pose", category_id=category.id)
        muscle = Muscle(name="Default Muscle", body_part="arms")
        db_session.add_all([pose, muscle])
        db_session.commit()

        pm = PoseMuscle(pose_id=pose.id, muscle_id=muscle.id)
        db_session.add(pm)
        db_session.commit()

        # Default should be 50 based on model definition
        assert pm.activation_level == 50

    def test_high_activation_muscles(self, db_session):
        category = Category(name="High Cat")
        db_session.add(category)
        db_session.commit()

        pose = Pose(code="HIGH", name="High Pose", category_id=category.id)
        db_session.add(pose)
        db_session.commit()

        muscles_data = [
            ("Low", 20),
            ("Medium", 50),
            ("High", 80),
            ("Max", 100),
        ]

        for name, level in muscles_data:
            muscle = Muscle(name=f"{name} Muscle", body_part="core")
            db_session.add(muscle)
            db_session.commit()

            pm = PoseMuscle(
                pose_id=pose.id, muscle_id=muscle.id, activation_level=level
            )
            db_session.add(pm)

        db_session.commit()

        high_activation = (
            db_session.query(PoseMuscle)
            .filter(PoseMuscle.pose_id == pose.id, PoseMuscle.activation_level >= 70)
            .all()
        )
